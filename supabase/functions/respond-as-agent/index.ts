// respond-as-agent — generates an AEGIS Mobile agent response for a
// conversation @-mention.
//
// Tier 1 chat-agent flow:
//   1. Operator types @AEGIS-CMD what's the latest on Coastal GasLink?
//   2. Mobile inserts an unencrypted message with mentioned_agent_id =
//      AEGIS-CMD's UUID and is_agent_query = true.
//   3. Mobile calls this function with { conversation_id, message_id }.
//   4. We:
//      a. Load the agent's persona / specialty / system_prompt from
//         ai_agents.
//      b. Load the conversation participants + the last N readable
//         messages (skip rows where encrypted=true; we cannot read
//         them and they're outside the agent's context window by
//         design).
//      c. Resolve attachments referenced by the trigger message and
//         pass URLs through to the LLM.
//      d. Call OpenAI gpt-4o-mini with the full context.
//      e. INSERT a new row in messages with agent_id = the agent and
//         sender_id = NULL. The CHECK constraint forces exactly one
//         of sender/agent.
//
// Auth: caller must be a participant of the conversation. Service
// role is used for the agent's INSERT (RLS would otherwise reject
// because no authenticated user_id is responsible for it).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HISTORY_LIMIT = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const { data: userResp, error: userErr } = await admin.auth.getUser(
      auth.replace(/^Bearer\s+/i, "")
    );
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userResp.user.id;

    const body = await req.json();
    const conversationId: string = body.conversation_id;
    const messageId: string = body.message_id;
    // When the operator @-mentions multiple agents in one message the
    // mobile client fans out one call per agent and passes the agent's
    // UUID in agent_id_override. If absent we fall back to the trigger
    // message's mentioned_agent_id (the single-agent path).
    const agentIdOverride: string | null = body.agent_id_override ?? null;
    if (!conversationId || !messageId) {
      return new Response(
        JSON.stringify({ error: "conversation_id and message_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Caller must participate in this conversation
    const { data: pcheck } = await admin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", callerId)
      .maybeSingle();
    if (!pcheck) {
      return new Response(
        JSON.stringify({ error: "not a participant of that conversation" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Trigger message
    const { data: trigger, error: trigErr } = await admin
      .from("messages")
      .select("id, content, attachments, mentioned_agent_id, encrypted, sender_id, created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (trigErr || !trigger) {
      return new Response(JSON.stringify({ error: "trigger message not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const targetAgentId = agentIdOverride ?? trigger.mentioned_agent_id;
    if (!targetAgentId) {
      return new Response(
        JSON.stringify({ error: "no agent specified (agent_id_override or mentioned_agent_id required)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Agent metadata
    const { data: agent, error: agentErr } = await admin
      .from("ai_agents")
      .select("id, call_sign, codename, persona, specialty, mission_scope, system_prompt")
      .eq("id", targetAgentId)
      .maybeSingle();
    if (agentErr || !agent) {
      return new Response(JSON.stringify({ error: "agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Last N readable messages (skip encrypted — agent can't read them
    // and shouldn't pretend to)
    const { data: history } = await admin
      .from("messages")
      .select("id, content, sender_id, agent_id, encrypted, created_at, attachments")
      .eq("conversation_id", conversationId)
      .eq("encrypted", false)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT);

    // Resolve sender display names + agent call_signs in one pass
    const userIds = [...new Set((history ?? []).map((m) => m.sender_id).filter(Boolean) as string[])];
    const agentIds = [...new Set((history ?? []).map((m) => m.agent_id).filter(Boolean) as string[])];
    const [profilesRes, agentsRes] = await Promise.all([
      userIds.length > 0
        ? admin.from("profiles").select("id, name").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      agentIds.length > 0
        ? admin.from("ai_agents").select("id, call_sign").in("id", agentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const profileMap = Object.fromEntries(
      (profilesRes.data ?? []).map((p: any) => [p.id, p.name || "Operator"])
    );
    const agentMap = Object.fromEntries(
      (agentsRes.data ?? []).map((a: any) => [a.id, a.call_sign])
    );

    const transcript = (history ?? [])
      .map((m) => {
        const speaker = m.agent_id
          ? agentMap[m.agent_id] || "AGENT"
          : profileMap[m.sender_id ?? ""] || "OPERATOR";
        const attachmentNote = (m.attachments && m.attachments.length > 0)
          ? ` [+${m.attachments.length} attachment(s)]`
          : "";
        return `${speaker}: ${m.content}${attachmentNote}`;
      })
      .join("\n");

    // Attachments on the trigger message — pass URLs so the model can
    // reference them. (For images, OpenAI Vision via gpt-4o-mini works
    // with image_url content parts; we keep this implementation simple
    // and just append URLs as text. Upgrade path noted in comments.)
    const triggerAttachments = (trigger.attachments ?? []) as Array<{ url?: string; name?: string; type?: string }>;
    const attachmentLines = triggerAttachments
      .filter((a) => a.url)
      .map((a) => `- ${a.name || "attachment"} (${a.type || "unknown"}): ${a.url}`)
      .join("\n");

    // ── MEMORY + BELIEFS RETRIEVAL ──────────────────────────────────
    // Embed the operator's question and pull the most relevant prior
    // exchanges (episodic memory) + current beliefs (semantic). The
    // model gets these as separate prompt sections so it can ground
    // its response in what the agent already "knows" instead of
    // answering each question in a vacuum.
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const conversationClientId = await (async () => {
      // Conversations don't have a direct client_id today; derive from
      // the most-mentioned client across the active participants. Cheap
      // approximation that scopes memory recall correctly for typical
      // single-client conversations.
      const { data: convRow } = await admin
        .from("conversations")
        .select("client_id")
        .eq("id", conversationId)
        .maybeSingle();
      return (convRow as any)?.client_id ?? null;
    })();

    let memoryEmbedding: number[] | null = null;
    let memories: Array<{ operator_excerpt: string; agent_excerpt: string; similarity: number }> = [];
    let beliefs: Array<{ claim: string; confidence: number; reinforcements: number }> = [];
    try {
      const embedResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: trigger.content.slice(0, 4000),
        }),
      });
      if (embedResp.ok) {
        const j = await embedResp.json();
        memoryEmbedding = j.data?.[0]?.embedding ?? null;
      }
    } catch (e) {
      console.warn("[respond-as-agent] embed failed:", e);
    }

    if (memoryEmbedding) {
      const [memRes, belRes] = await Promise.all([
        admin.rpc("match_agent_memories", {
          _agent_id: agent.id,
          _query: memoryEmbedding,
          _client: conversationClientId,
          _limit: 8,
        }),
        admin.rpc("match_agent_chat_beliefs", {
          _agent_id: agent.id,
          _query: memoryEmbedding,
          _client: conversationClientId,
          _limit: 6,
        }),
      ]);
      // Filter to meaningful matches only (cosine similarity > 0.4 to
      // avoid noise; below that threshold the memory probably isn't
      // about the same topic).
      memories = (memRes.data ?? []).filter((m: any) => (m.similarity ?? 0) > 0.4);
      beliefs = (belRes.data ?? []).filter((b: any) => (b.similarity ?? 0) > 0.45);
    }

    const memorySection =
      memories.length > 0
        ? `\n\nRELEVANT PRIOR EXCHANGES (oldest → newest, your own past responses are signed AGENT):\n${memories
            .reverse()
            .map(
              (m, i) =>
                `[${i + 1}] OPERATOR: ${m.operator_excerpt.slice(0, 220)}\n    AGENT: ${m.agent_excerpt.slice(0, 280)}`
            )
            .join("\n")}`
        : "";

    const beliefsSection =
      beliefs.length > 0
        ? `\n\nYOUR CURRENT BELIEFS (claim — confidence — # reinforcements):\n${beliefs
            .map(
              (b) =>
                `• ${b.claim} — ${Math.round((b.confidence ?? 0) * 100)}% — n=${b.reinforcements ?? 1}`
            )
            .join("\n")}`
        : "";

    // Build system prompt — agent persona + framework + chat-mode
    // guardrails so the agent stays terse and on-topic.
    const baseSystemPrompt =
      agent.system_prompt ||
      `You are ${agent.call_sign}, a Silent Shield specialist.\nPersona: ${agent.persona}\nSpecialty: ${agent.specialty}\nMission scope: ${agent.mission_scope}`;

    const systemPrompt = `${baseSystemPrompt}

CHAT-MODE GUARDRAILS:
- Operators are mentioning you in a team chat. Stay terse — bullet points or 1-3 sentences. No long lectures.
- You have full transcript context of this conversation (encrypted messages are excluded; you only see what's readable).
- If you genuinely don't have the data to answer, say so plainly. Do not invent intel.
- Stay in your persona. Use the framework language your specialty implies (CSIS / RCMP INSET for counterterror, NIST for cyber, etc.) where relevant.
- If the operator asked you to do something, confirm whether you actually can or can't.

USING YOUR MEMORY + BELIEFS:
- Below you may see RELEVANT PRIOR EXCHANGES from earlier conversations. Treat them as your own past statements; reuse facts and refine when you learn something new.
- YOUR CURRENT BELIEFS are claims you've accumulated over time, with confidence + reinforcement count. If your belief is being challenged in this conversation, acknowledge that directly. If a new exchange should update a belief, say so plainly so we can record it.${memorySection}${beliefsSection}`;

    // Build user message — chat history + the trigger
    const triggerSpeaker = profileMap[trigger.sender_id ?? ""] || "OPERATOR";
    const userPrompt = `Team conversation transcript (oldest → newest):
${transcript || "(no prior messages)"}

The operator just mentioned you with this message:
${triggerSpeaker}: ${trigger.content}${
      attachmentLines
        ? `\n\nAttachments referenced by the operator:\n${attachmentLines}`
        : ""
    }

Respond as ${agent.call_sign}.`;

    const llm = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!llm.ok) {
      const text = await llm.text();
      console.error("[respond-as-agent] OpenAI error:", llm.status, text);
      return new Response(
        JSON.stringify({ error: `LLM upstream error (${llm.status}): ${text.slice(0, 240)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const llmJson = await llm.json();
    const content: string = llmJson?.choices?.[0]?.message?.content?.trim() || "(no response)";

    // Insert agent message — sender_id null, agent_id set, not encrypted.
    const { data: agentMsg, error: insErr } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        agent_id: agent.id,
        content,
        encrypted: false,
        nonce: null,
        attachments: [],
      })
      .select("id, content, agent_id, created_at")
      .single();
    if (insErr || !agentMsg) {
      console.error("[respond-as-agent] insert failed:", insErr);
      return new Response(JSON.stringify({ error: insErr?.message ?? "could not save response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PERSIST MEMORY ───────────────────────────────────────────────
    // Embed the [trigger + response] pair so future questions can
    // retrieve this exchange. Uses the same query embedding when we
    // already computed one to save a round-trip; otherwise embeds the
    // joined text now.
    try {
      const memoryText = `Q: ${trigger.content.slice(0, 1000)}\nA: ${content.slice(0, 1500)}`;
      let memEmbed = memoryEmbedding;
      if (!memEmbed || trigger.content.length > 200) {
        const e = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: memoryText.slice(0, 4000),
          }),
        });
        if (e.ok) {
          const j = await e.json();
          memEmbed = j.data?.[0]?.embedding ?? memEmbed;
        }
      }
      await admin.from("agent_conversation_memory").insert({
        agent_id: agent.id,
        conversation_id: conversationId,
        trigger_message_id: trigger.id,
        response_message_id: agentMsg.id,
        operator_excerpt: trigger.content.slice(0, 1000),
        agent_excerpt: content.slice(0, 1500),
        embedding: memEmbed,
        operator_id: trigger.sender_id,
        client_id: conversationClientId,
      });
    } catch (e) {
      console.warn("[respond-as-agent] memory persist failed:", e);
    }

    // ── BELIEF EXTRACTION (async, fire-and-forget) ──────────────────
    // Have the model distill claims from its own response. Each claim
    // gets embedded; if a similar belief already exists (cosine > 0.85),
    // reinforce it; else insert. This is non-blocking — the operator
    // already has the agent's reply.
    (async () => {
      try {
        const claimResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Extract atomic, falsifiable claims from the agent response. Return JSON: {claims: [{claim: string, confidence: number 0-1}]}. Only include claims the agent stated as true (not questions, not conditionals). Maximum 5 claims. Return strictly JSON, no commentary.",
              },
              {
                role: "user",
                content: `Agent: ${agent.call_sign}\nResponse:\n${content}`,
              },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (!claimResp.ok) return;
        const cj = await claimResp.json();
        const raw = cj?.choices?.[0]?.message?.content;
        if (!raw) return;
        let parsed: { claims?: Array<{ claim: string; confidence?: number }> } = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const claims = (parsed.claims ?? []).filter(
          (c) => c?.claim && c.claim.length > 12 && c.claim.length < 400
        );
        if (claims.length === 0) return;

        // Embed all claims in one call
        const embReq = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: claims.map((c) => c.claim),
          }),
        });
        if (!embReq.ok) return;
        const embJson = await embReq.json();
        const embeddings: number[][] = (embJson.data ?? []).map((d: any) => d.embedding);

        for (let i = 0; i < claims.length; i++) {
          const claim = claims[i].claim.trim();
          const confidence = Math.max(
            0.3,
            Math.min(0.95, claims[i].confidence ?? 0.6)
          );
          const emb = embeddings[i];
          if (!emb) continue;

          // Look for an existing belief with cosine > 0.85
          const { data: matches } = await admin.rpc("match_agent_chat_beliefs", {
            _agent_id: agent.id,
            _query: emb,
            _client: conversationClientId,
            _limit: 1,
          });
          const existing = (matches ?? [])[0];
          if (existing && (existing.similarity ?? 0) > 0.85) {
            // Reinforce: bump count, average confidence (weighted by reinforcements),
            // refresh last_reinforced_at
            const newReinforcements = (existing.reinforcements ?? 1) + 1;
            const newConfidence =
              ((existing.confidence ?? 0.5) * (existing.reinforcements ?? 1) + confidence) /
              newReinforcements;
            await admin
              .from("agent_chat_beliefs")
              .update({
                confidence: newConfidence,
                reinforcements: newReinforcements,
                last_reinforced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                origin_conversation_ids: undefined, // append below
              })
              .eq("id", existing.id);
            // Append the new conversation/message to provenance arrays
            await admin.rpc("append_belief_provenance" as any, {
              _belief_id: existing.id,
              _conversation_id: conversationId,
              _message_id: agentMsg.id,
            }).then(
              () => {},
              () => {
                // RPC may not exist — best-effort, ignore
              }
            );
          } else {
            await admin.from("agent_chat_beliefs").insert({
              agent_id: agent.id,
              claim,
              claim_embedding: emb,
              confidence,
              reinforcements: 1,
              origin_conversation_ids: [conversationId],
              origin_message_ids: [agentMsg.id],
              scope_client_id: conversationClientId,
            });
          }
        }
      } catch (e) {
        console.warn("[respond-as-agent] belief extraction failed:", e);
      }
    })();

    return new Response(
      JSON.stringify({
        message_id: agentMsg.id,
        content: agentMsg.content,
        agent_id: agentMsg.agent_id,
        agent_call_sign: agent.call_sign,
        created_at: agentMsg.created_at,
        memories_used: memories.length,
        beliefs_used: beliefs.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[respond-as-agent] unhandled:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
