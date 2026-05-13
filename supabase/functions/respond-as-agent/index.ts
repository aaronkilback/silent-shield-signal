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
import { recallChatContext, learnFromChatExchange } from "../_shared/agent-chat-memory.ts";
import { runAgentLoop } from "../_shared/agent-tools.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
// Side-effect import — registers every tool defined in agent-tools-core.ts.
// Adding a new tool there (or in any other file that calls registerTool)
// makes it automatically available to chat agents on next deploy. No
// per-function plumbing required.
import "../_shared/agent-tools-core.ts";

// Cap how many images we send to vision in one mention. Mostly a cost
// + latency guardrail; mobile only lets you attach a few at a time
// anyway.
const MAX_VISION_IMAGES = 4;

// Wildfire-specific vision prompt — same one the public portal uses.
// Tailored to NE BC oil-and-gas field-worker context.
const VISION_PROMPT_WILDFIRE = `You are a wildfire visual-analysis specialist. The operator (a field worker or analyst, often in NE BC oil-and-gas country) attached one or more photos. Analyze them for wildfire-relevant content. Be concrete and operationally honest about what you can and cannot tell from a still image.

For each image, report (use markdown sections, no preamble):
- **Subject** — fire, smoke column, both, aftermath, or non-wildfire content. State it.
- **Smoke** — color (white = water-heavy / early, gray = mature, dark = active/high-carbon, brown = vegetation/crown, black = synthetic/structures); shape (vertical / bent / pyrocumulus); apparent drift direction.
- **Flame** (if visible) — height vs. surrounding vegetation; intensity cues.
- **Distance estimate** — cite the scale reference (foreground tree, vehicle, road, structure, terrain feature) AND give an uncertainty range (e.g. "~3–8 km based on tree-line scale"). If unable, say so plainly.
- **Fuel / terrain** — visible fuel and terrain (drainage / ridge / flat).
- **Wildfire vs. industrial flare** — call out if it reads more like a flare (hot point source, no advancing front, near visible facility).

If an image is clearly NOT wildfire-relevant (selfie, screenshot, document), say so in one line and stop for that image. <250 words per image.`;

// Generic fallback prompt for non-WILDFIRE agents — describe the
// image with operationally relevant detail without trying to act as
// a domain specialist.
const VISION_PROMPT_GENERIC = `You are a visual-analysis assistant supporting a Silent Shield specialist agent. The operator attached one or more images. Describe each one factually with detail an intelligence / security analyst would care about.

For each image (markdown sections, no preamble):
- **Subject** — what's the main thing in frame.
- **Notable details** — anything that matters operationally (people, vehicles, weapons, license plates if legible, signs, text on documents, distinctive clothing, location/terrain cues, time-of-day evidence).
- **What you can't tell** — be honest about limits (no GPS, can't read blurred plate, etc.).

If an image is clearly mundane (selfie with no operational content, decorative screenshot), say so in one line. <200 words per image. No speculation.`;

const IMAGE_TYPE_PREFIX = "image/";
function isImageAttachment(a: { url?: string; type?: string; name?: string }): boolean {
  if (!a.url) return false;
  if (a.type && a.type.startsWith(IMAGE_TYPE_PREFIX)) return true;
  // Fallback on extension when type is missing/wrong.
  const u = a.url.toLowerCase().split("?")[0];
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(u);
}

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

    // Agent metadata. F-018 (2026-05-13): filter by is_active so deactivated
    // agents cannot be dispatched even via direct ID lookup. Scout (deactivated
    // 2026-05-10) fired twice afterward through some path that bypassed the
    // flag — this is the most likely entry point.
    const { data: agent, error: agentErr } = await admin
      .from("ai_agents")
      .select("id, call_sign, codename, persona, specialty, mission_scope, system_prompt, is_active")
      .eq("id", targetAgentId)
      .eq("is_active", true)
      .maybeSingle();
    if (agentErr || !agent) {
      return new Response(JSON.stringify({ error: "agent not found or not active" }), {
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

    // Attachments on the trigger message. Image attachments get a
    // dedicated vision pass below; non-image attachments (PDFs, video)
    // are still listed by URL for the agent to reference.
    const triggerAttachments = (trigger.attachments ?? []) as Array<{ url?: string; name?: string; type?: string }>;
    const imageAttachments = triggerAttachments.filter(isImageAttachment).slice(0, MAX_VISION_IMAGES);
    const nonImageAttachments = triggerAttachments.filter((a) => a.url && !isImageAttachment(a));
    const attachmentLines = nonImageAttachments
      .map((a) => `- ${a.name || "attachment"} (${a.type || "unknown"}): ${a.url}`)
      .join("\n");

    // ── VISION PASS (when images are attached) ──────────────────────
    // message-attachments bucket is public (see migration
    // 20260501000001_aegis_mobile_messaging.sql), so we hand the URLs
    // straight to gpt-4o vision instead of downloading + base64-ing.
    // Wildfire-specific prompt when responding as WILDFIRE; generic
    // prompt otherwise so other agents (APEX, FERAL, AEGIS-CMD)
    // still get useful descriptions if an operator pastes a photo
    // into a thread.
    let visionAnalysis: string | null = null;
    let visionError: string | null = null;
    if (imageAttachments.length > 0) {
      const visionPrompt = agent.call_sign === "WILDFIRE"
        ? VISION_PROMPT_WILDFIRE
        : VISION_PROMPT_GENERIC;
      const imageParts = imageAttachments.map((a) => ({
        type: "image_url" as const,
        image_url: { url: a.url as string },
      }));
      const captionText = trigger.content?.trim()
        ? `Operator caption accompanying the photo${imageAttachments.length > 1 ? "s" : ""}: "${trigger.content}"`
        : `(No accompanying caption — analyze the photo${imageAttachments.length > 1 ? "s" : ""} on its own.)`;
      const tVisionStart = Date.now();
      const visionResult = await callAiGateway({
        functionName: "respond-as-agent:vision",
        model: "openai/gpt-4o",
        skipGuardrails: true,
        messages: [
          { role: "system", content: visionPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: captionText },
              ...imageParts,
            ],
          },
        ] as any,
      });
      const visionMs = Date.now() - tVisionStart;
      if (visionResult.error || !visionResult.content) {
        visionError = visionResult.error || "Vision pass returned no content.";
        console.warn(`[respond-as-agent] vision pass failed (${visionMs}ms, ${imageAttachments.length} image${imageAttachments.length > 1 ? "s" : ""}): ${visionError}`);
      } else {
        visionAnalysis = visionResult.content.trim();
        console.log(`[respond-as-agent] vision pass ok in ${visionMs}ms (${imageAttachments.length} image${imageAttachments.length > 1 ? "s" : ""}, ${visionAnalysis.length} chars)`);
      }
    }

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

    const recall = await recallChatContext(admin, {
      agentId: agent.id,
      query: trigger.content,
      clientId: conversationClientId,
    });
    const { memories, beliefs, queryEmbedding: memoryEmbedding } = recall;

    // Build system prompt — agent persona + framework + chat-mode
    // guardrails so the agent stays terse and on-topic.
    const baseSystemPrompt =
      agent.system_prompt ||
      `You are ${agent.call_sign}, a Silent Shield specialist.\nPersona: ${agent.persona}\nSpecialty: ${agent.specialty}\nMission scope: ${agent.mission_scope}`;

    const systemPrompt = `${baseSystemPrompt}

CHAT-MODE GUARDRAILS:
- Operators are mentioning you in a team chat. Stay terse — bullet points or 1-3 sentences. No long lectures.
- You have full transcript context of this conversation (encrypted messages are excluded; you only see what's readable).
- Stay in your persona. Use the framework language your specialty implies (CSIS / RCMP INSET for counterterror, NIST for cyber, etc.) where relevant.

USING YOUR TOOLS — HARD RULE:
- Before stating ANY specific fact (numbers, locations, "no active fires", "X signals in the last 24h", entity relationships, current status, recent events, danger levels), you MUST call a tool to verify.
- Acceptable to answer from training only if the operator asked a CONCEPTUAL question ("what is FWI?", "what does CARVER measure?"). Anything operational requires a tool call. NOTE: CARVER scores for client assets are now real platform data — when asked for a specific asset's score or priority, call query_carver_scores; do not answer from training.
- If you're tempted to say "based on current data..." or "as of today..." or "no [thing] reported within X km" — STOP, call lookup_historical_signals or get_signal_velocity or query_entity_relationships first. Don't make claims you didn't verify.
- If tools return nothing, say so honestly: "I queried lookup_historical_signals for Fort St. John in the last 7 days — no wildfire signals matched. I cannot confirm fire status from chat tools alone; check the Wildfire Daily Report for FIRMS-derived data."
- Tool calls are cheap. Use 1-3 per turn when they help.
- DO NOT stall with "querying...", "let me check", "please hold" — actually call the tool now and answer in this turn.

USING YOUR MEMORY + BELIEFS:
- Below you may see RELEVANT PRIOR EXCHANGES from earlier conversations. Treat them as your own past statements; reuse facts and refine when you learn something new.
- YOUR CURRENT BELIEFS are claims you've accumulated over time, with confidence + reinforcement count. If a new exchange should update a belief, say so plainly so we can record it.${recall.promptInjection}`;

    // Build user message — chat history + the trigger
    const triggerSpeaker = profileMap[trigger.sender_id ?? ""] || "OPERATOR";

    // Compose attachment context. Image attachments are summarized via
    // the vision analysis (the agent can't see the image directly, but
    // it can reason over the analysis). Non-image attachments are still
    // listed as URLs.
    let attachmentSection = "";
    if (visionAnalysis) {
      attachmentSection = `\n\nThe operator attached ${imageAttachments.length} image${imageAttachments.length > 1 ? "s" : ""}. A vision specialist analyzed ${imageAttachments.length > 1 ? "them" : "it"}; their findings are below verbatim. Treat these as ground truth about the image${imageAttachments.length > 1 ? "s" : ""} (you cannot see them yourself).\n\n--- VISION ANALYSIS ---\n${visionAnalysis}\n--- END VISION ANALYSIS ---\n\nWhen you reply, begin with a short bolded "**Photo read:**" line that paraphrases the vision findings in 1-3 sentences so the operator sees what you saw. Then call any tools needed to ground operational guidance against current data, and end with a one-line "**What to do now:**".`;
    } else if (visionError && imageAttachments.length > 0) {
      attachmentSection = `\n\nThe operator attached ${imageAttachments.length} image${imageAttachments.length > 1 ? "s" : ""}, but the vision analysis failed (${visionError}). Acknowledge that the photo${imageAttachments.length > 1 ? "s" : ""} couldn't be analyzed and respond based on their text message and any attachment URLs below.`;
    }
    if (attachmentLines) {
      attachmentSection += `\n\nNon-image attachments referenced by the operator:\n${attachmentLines}`;
    }

    const userPrompt = `Team conversation transcript (oldest → newest):
${transcript || "(no prior messages)"}

The operator just mentioned you with this message:
${triggerSpeaker}: ${trigger.content}${attachmentSection}

Respond as ${agent.call_sign}.`;

    // ── ITERATIVE TOOL LOOP ──────────────────────────────────────────
    // Run the agent through the same tool-use loop ai-decision-engine
    // uses for signal investigation. Every tool registered in
    // _shared/agent-tools-core.ts is automatically available — when a
    // new tool is added there, chat agents inherit it on next deploy.
    // No per-function plumbing, no allow-list to maintain.
    const investigation = await runAgentLoop(admin, {
      agentCallSign: agent.call_sign,
      functionName: "respond-as-agent",
      // gpt-4o-mini was answering from parametric memory instead of
      // calling tools (operator caught WILDFIRE fabricating "no active
      // fires within 30km" without any verification call). gpt-4o is
      // significantly more reliable at choosing to invoke tools when
      // a question requires real data.
      model: "openai/gpt-4o",
      contextClientId: conversationClientId ?? undefined,
      maxIterations: 5,
      systemPrompt,
      userMessage: userPrompt,
    });

    if (investigation.error && !investigation.finalContent) {
      console.error("[respond-as-agent] tool loop error:", investigation.error);
      return new Response(
        JSON.stringify({ error: `agent loop error: ${investigation.error}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const content: string = (investigation.finalContent ?? "").trim() || "(no response)";

    // Insert agent message — sender_id null, agent_id set, not encrypted.
    // Persist the tool-call trace in metadata so the UI can later show
    // "what tools the agent used to answer this".
    const toolCallSummary =
      investigation.toolCalls.length > 0
        ? investigation.toolCalls.map((t) => ({
            name: t.toolName,
            args: t.args,
            iteration: t.iteration,
            duration_ms: t.durationMs,
            error: t.errorMessage ?? null,
          }))
        : null;

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

    // ── LEARN: persist memory + extract beliefs (fire-and-forget) ───
    void learnFromChatExchange(admin, {
      agentId: agent.id,
      agentCallSign: agent.call_sign,
      conversationId,
      triggerMessageId: trigger.id,
      responseMessageId: agentMsg.id,
      operatorExcerpt: trigger.content,
      agentExcerpt: content,
      operatorId: trigger.sender_id,
      clientId: conversationClientId,
      queryEmbedding: memoryEmbedding,
    });

    return new Response(
      JSON.stringify({
        message_id: agentMsg.id,
        content: agentMsg.content,
        agent_id: agentMsg.agent_id,
        agent_call_sign: agent.call_sign,
        created_at: agentMsg.created_at,
        memories_used: memories.length,
        beliefs_used: beliefs.length,
        tool_calls: toolCallSummary,
        iterations: investigation.iterations,
        capped_at_max: investigation.cappedAtMax,
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
