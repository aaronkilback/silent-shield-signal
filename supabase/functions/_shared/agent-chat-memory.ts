/**
 * Agent Chat Memory + Beliefs — shared helpers used by every agent
 * chat backend (respond-as-agent, aegis-chat, dashboard-ai-assistant)
 * so a conversation in any surface contributes to and benefits from
 * the same learning layer.
 *
 * Two tables back this:
 *   agent_conversation_memory — episodic, embedded operator/agent
 *     exchanges keyed by agent_id (Fortress ai_agents.id UUID).
 *   agent_chat_beliefs        — semantic, distilled atomic claims
 *     with confidence + reinforcement count.
 *
 * Distinct from `_shared/agent-memory.ts` (investigation memory keyed
 * by agent_call_sign).
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RecalledMemory {
  operator_excerpt: string;
  agent_excerpt: string;
  similarity: number;
}

export interface RecalledBelief {
  claim: string;
  confidence: number;
  reinforcements: number;
}

export interface RecallResult {
  memories: RecalledMemory[];
  beliefs: RecalledBelief[];
  /** Embedding of the query — pass to learnFromChatExchange to skip a re-embed. */
  queryEmbedding: number[] | null;
  /** Pre-formatted prompt sections, ready to inline. Empty string if nothing relevant. */
  promptInjection: string;
}

const EMBED_MODEL = "text-embedding-3-small";

async function embed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function embedBatch(inputs: string[]): Promise<Array<number[] | null>> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return inputs.map(() => null);
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs.map((s) => s.slice(0, 8000)) }),
    });
    if (!r.ok) return inputs.map(() => null);
    const j = await r.json();
    return (j?.data ?? []).map((d: any) => d?.embedding ?? null);
  } catch {
    return inputs.map(() => null);
  }
}

/**
 * Pull the top relevant memories and beliefs for an agent given a query.
 * Returns a pre-formatted prompt-injection string ready to drop into
 * the agent's system prompt.
 */
export async function recallChatContext(
  supabase: SupabaseClient,
  opts: {
    agentId: string;
    query: string;
    clientId?: string | null;
    memoryLimit?: number;
    beliefLimit?: number;
    /** Cosine sim floor for memory inclusion. Default 0.4. */
    memoryThreshold?: number;
    /** Cosine sim floor for belief inclusion. Default 0.45. */
    beliefThreshold?: number;
  }
): Promise<RecallResult> {
  const queryEmbedding = await embed(opts.query);
  if (!queryEmbedding) {
    return { memories: [], beliefs: [], queryEmbedding: null, promptInjection: "" };
  }
  const memThreshold = opts.memoryThreshold ?? 0.4;
  const belThreshold = opts.beliefThreshold ?? 0.45;

  const [memRes, belRes] = await Promise.all([
    supabase.rpc("match_agent_memories", {
      _agent_id: opts.agentId,
      _query: queryEmbedding,
      _client: opts.clientId ?? null,
      _limit: opts.memoryLimit ?? 8,
    }),
    supabase.rpc("match_agent_chat_beliefs", {
      _agent_id: opts.agentId,
      _query: queryEmbedding,
      _client: opts.clientId ?? null,
      _limit: opts.beliefLimit ?? 6,
    }),
  ]);

  const memories: RecalledMemory[] = (memRes.data ?? [])
    .filter((m: any) => (m.similarity ?? 0) > memThreshold)
    .map((m: any) => ({
      operator_excerpt: m.operator_excerpt,
      agent_excerpt: m.agent_excerpt,
      similarity: m.similarity,
    }));
  const beliefs: RecalledBelief[] = (belRes.data ?? [])
    .filter((b: any) => (b.similarity ?? 0) > belThreshold)
    .map((b: any) => ({
      claim: b.claim,
      confidence: b.confidence ?? 0.5,
      reinforcements: b.reinforcements ?? 1,
    }));

  let promptInjection = "";
  if (memories.length > 0) {
    promptInjection += `\n\nRELEVANT PRIOR EXCHANGES (oldest → newest, AGENT lines are your past responses):\n`;
    promptInjection += memories
      .slice()
      .reverse()
      .map(
        (m, i) =>
          `[${i + 1}] OPERATOR: ${m.operator_excerpt.slice(0, 220)}\n    AGENT: ${m.agent_excerpt.slice(0, 280)}`
      )
      .join("\n");
  }
  if (beliefs.length > 0) {
    promptInjection += `\n\nYOUR CURRENT BELIEFS (claim — confidence — # reinforcements):\n`;
    promptInjection += beliefs
      .map(
        (b) =>
          `• ${b.claim} — ${Math.round(b.confidence * 100)}% — n=${b.reinforcements}`
      )
      .join("\n");
  }

  return { memories, beliefs, queryEmbedding, promptInjection };
}

/**
 * Persist a chat exchange as a memory and asynchronously extract any
 * atomic claims into agent_chat_beliefs. Reinforces existing beliefs
 * if a near-duplicate already exists (cosine > 0.85), otherwise inserts
 * a new one.
 *
 * Belief extraction uses gpt-4o-mini and runs as a fire-and-forget
 * IIFE — the caller does NOT await it. Memory write IS awaited so the
 * exchange is recallable on the next turn.
 */
export async function learnFromChatExchange(
  supabase: SupabaseClient,
  opts: {
    agentId: string;
    agentCallSign: string;
    conversationId: string;
    triggerMessageId?: string | null;
    responseMessageId?: string | null;
    operatorExcerpt: string;
    agentExcerpt: string;
    operatorId?: string | null;
    clientId?: string | null;
    /** Re-use this if the caller already embedded the query. */
    queryEmbedding?: number[] | null;
  }
): Promise<void> {
  const memoryText = `Q: ${opts.operatorExcerpt.slice(0, 1000)}\nA: ${opts.agentExcerpt.slice(0, 1500)}`;

  // Use the cached query embedding if it covers the operator question
  // tightly; otherwise re-embed so the memory captures both sides.
  let memEmbed = opts.queryEmbedding ?? null;
  if (!memEmbed || opts.operatorExcerpt.length > 200) {
    memEmbed = await embed(memoryText);
  }

  await supabase.from("agent_conversation_memory").insert({
    agent_id: opts.agentId,
    conversation_id: opts.conversationId,
    trigger_message_id: opts.triggerMessageId ?? null,
    response_message_id: opts.responseMessageId ?? null,
    operator_excerpt: opts.operatorExcerpt.slice(0, 1000),
    agent_excerpt: opts.agentExcerpt.slice(0, 1500),
    embedding: memEmbed,
    operator_id: opts.operatorId ?? null,
    client_id: opts.clientId ?? null,
  });

  // Belief extraction — async, fire-and-forget. We don't await this.
  void extractAndPersistBeliefs(supabase, opts);
}

async function extractAndPersistBeliefs(
  supabase: SupabaseClient,
  opts: {
    agentId: string;
    agentCallSign: string;
    conversationId: string;
    responseMessageId?: string | null;
    agentExcerpt: string;
    clientId?: string | null;
  }
): Promise<void> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract atomic, falsifiable claims the agent stated as TRUE. Skip questions, conditionals, hypotheticals. Return JSON: {claims: [{claim: string, confidence: number 0-1}]}. Maximum 5 claims. Strictly JSON.",
          },
          { role: "user", content: `Agent: ${opts.agentCallSign}\nResponse:\n${opts.agentExcerpt}` },
        ],
      }),
    });
    if (!r.ok) return;
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
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

    const claimEmbeddings = await embedBatch(claims.map((c) => c.claim));
    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i].claim.trim();
      const confidence = Math.max(0.3, Math.min(0.95, claims[i].confidence ?? 0.6));
      const emb = claimEmbeddings[i];
      if (!emb) continue;

      const { data: matches } = await supabase.rpc("match_agent_chat_beliefs", {
        _agent_id: opts.agentId,
        _query: emb,
        _client: opts.clientId ?? null,
        _limit: 1,
      });
      const existing = (matches ?? [])[0] as any;
      if (existing && (existing.similarity ?? 0) > 0.85) {
        const newReinforcements = (existing.reinforcements ?? 1) + 1;
        const newConfidence =
          ((existing.confidence ?? 0.5) * (existing.reinforcements ?? 1) + confidence) /
          newReinforcements;
        await supabase
          .from("agent_chat_beliefs")
          .update({
            confidence: newConfidence,
            reinforcements: newReinforcements,
            last_reinforced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("agent_chat_beliefs").insert({
          agent_id: opts.agentId,
          claim,
          claim_embedding: emb,
          confidence,
          reinforcements: 1,
          origin_conversation_ids: [opts.conversationId],
          origin_message_ids: opts.responseMessageId ? [opts.responseMessageId] : [],
          scope_client_id: opts.clientId ?? null,
        });
      }
    }
  } catch (e) {
    console.warn("[agent-chat-memory] belief extraction failed:", e);
  }
}
