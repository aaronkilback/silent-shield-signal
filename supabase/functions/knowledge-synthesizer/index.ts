/**
 * knowledge-synthesizer
 *
 * Transforms the knowledge base from storage into intelligence:
 * 1. BELIEF FORMATION — per-agent analytical conclusions from accumulated knowledge
 * 2. CROSS-DOMAIN CONNECTIONS — non-obvious links between different agents' findings
 * 3. BELIEF EVOLUTION — confidence updates when new evidence arrives
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();

    const { data: heartbeatRow } = await supabase.from('cron_heartbeat').insert({
      job_name: 'knowledge-synthesizer-nightly',
      started_at: new Date().toISOString(),
      status: 'running',
    }).select('id').single();
    const heartbeatId: string | null = heartbeatRow?.id ?? null;

    const body = await req.json().catch(() => ({}));
    const {
      force = false,
      agent_call_sign,
      since_days = 7,
      since_hours,              // overrides since_days when set (for post-ingestion triggers)
      include_human_experts = false, // also fold in human expert entries matched by domain
      debug = false,
      mode = 'all',  // 'beliefs' | 'connections' | 'all'
      max_agents = 999, // cap agent processing for beliefs
    } = body;

    const since = since_hours
      ? new Date(Date.now() - since_hours * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - since_days * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('expert_knowledge')
      .select('id, expert_name, domain, subdomain, knowledge_type, title, content')
      .gte('created_at', since)
      .eq('is_active', true)
      .gte('confidence_score', 0.65)
      .order('created_at', { ascending: false })
      .like('expert_name', 'agent:%');

    if (agent_call_sign) query = query.eq('expert_name', `agent:${agent_call_sign}`);

    const { data: entries, error: loadErr } = await query.limit(300);
    if (loadErr) return errorResponse(loadErr.message, 500);

    // ── Load human expert entries (practitioners, ingest-expert-media) ──
    // These are NOT grouped by agent — instead they are matched to agents
    // by domain overlap and folded into each relevant agent's entry set.
    let humanEntries: any[] = [];
    if (include_human_experts) {
      const humanSince = new Date(Date.now() - Math.max(since_days, 14) * 24 * 60 * 60 * 1000).toISOString();
      const { data: he } = await supabase
        .from('expert_knowledge')
        .select('id, expert_name, domain, subdomain, knowledge_type, title, content')
        .gte('created_at', humanSince)
        .eq('is_active', true)
        .gte('confidence_score', 0.65)
        .not('expert_name', 'like', 'agent:%')
        .order('created_at', { ascending: false })
        .limit(60);
      humanEntries = he || [];
      console.log(`[knowledge-synthesizer] Loaded ${humanEntries.length} human expert entries for domain matching`);
    }

    if (!entries?.length && !humanEntries.length) {
      return successResponse({ message: 'No entries to synthesize', entries_checked: 0 });
    }

    // Group agent-hunted entries by agent
    const byAgent: Record<string, typeof entries> = {};
    for (const entry of (entries || [])) {
      const key = entry.expert_name || 'unknown';
      if (!byAgent[key]) byAgent[key] = [];
      byAgent[key].push(entry);
    }

    // Build a domain → human entries map for fast lookup
    const humanByDomain: Record<string, any[]> = {};
    for (const he of humanEntries) {
      if (!he.domain) continue;
      if (!humanByDomain[he.domain]) humanByDomain[he.domain] = [];
      humanByDomain[he.domain].push(he);
    }

    // When include_human_experts is set and we have agents with no agent-hunted entries
    // in the window, still process them so human expert knowledge reaches them.
    if (include_human_experts && humanEntries.length > 0 && !agent_call_sign) {
      const { data: activeAgents } = await supabase
        .from('ai_agents')
        .select('call_sign')
        .eq('is_active', true);
      for (const ag of (activeAgents || [])) {
        const key = `agent:${ag.call_sign}`;
        if (!byAgent[key]) byAgent[key] = [];
      }
    }

    let beliefsCreated = 0;
    let beliefsUpdated = 0;
    let connectionsCreated = 0;
    const diagnostics: Record<string, any> = {};

    const agentKeys = Object.keys(byAgent);

    // ── 1. BELIEF FORMATION (parallel batches of 4) ──────────────────
    const AGENT_BATCH = 4;
    const beliefAgentKeys = mode === 'connections' ? [] : agentKeys.slice(0, max_agents);
    for (let i = 0; i < beliefAgentKeys.length; i += AGENT_BATCH) {
      const batch = beliefAgentKeys.slice(i, i + AGENT_BATCH);
      const results = await Promise.allSettled(batch.map(async (agentKey) => {
        const agentEntries = byAgent[agentKey] || [];
        const callSign = agentKey.replace('agent:', '');

        // Fold in domain-matched human expert entries
        const agentDomains = new Set(agentEntries.map((e: any) => e.domain).filter(Boolean));
        // If no agent entries yet, infer domain from agent specialty
        if (agentDomains.size === 0 && include_human_experts) {
          // Add all human domains as candidates — the AI will still only use relevant ones
          for (const d of Object.keys(humanByDomain)) agentDomains.add(d);
        }
        const matchedHuman = [...agentDomains].flatMap(d => (humanByDomain[d] || []).slice(0, 4));
        const allEntries = [...agentEntries, ...matchedHuman];

        if (allEntries.length < 2) return { callSign, status: 'skipped:too_few_entries' };
        if (matchedHuman.length > 0) {
          console.log(`[knowledge-synthesizer] ${callSign}: folding in ${matchedHuman.length} human expert entries (domains: ${[...agentDomains].join(', ')})`);
        }

        const { beliefs, rawContent, geminiError } = await extractAgentBeliefs(callSign, allEntries);

        if (geminiError) return { callSign, status: `gemini_error:${geminiError}` };
        if (!beliefs.length) return { callSign, status: `parse_fail`, rawPreview: rawContent?.substring(0, 600) };

        let created = 0;
        let updated = 0;

        for (const belief of beliefs) {
          const { data: existing } = await supabase
            .from('agent_beliefs')
            .select('id, confidence, evolution_log')
            .eq('agent_call_sign', callSign)
            .eq('is_active', true)
            .ilike('hypothesis', `%${belief.hypothesis.substring(0, 45).replace(/[%_]/g, ' ')}%`)
            .limit(1);

          if (existing?.length) {
            const old = existing[0];
            const newConf = Math.round(((old.confidence * 0.6) + (belief.confidence * 0.4)) * 100) / 100;
            if (Math.abs(newConf - old.confidence) < 0.02) continue;
            const log = [...(old.evolution_log || []), {
              date: new Date().toISOString(),
              old_confidence: old.confidence,
              new_confidence: newConf,
              reason: `Evidence synthesis Δ${(newConf - old.confidence) > 0 ? '+' : ''}${(newConf - old.confidence).toFixed(2)}`,
            }];
            await supabase.from('agent_beliefs').update({ confidence: newConf, last_updated_at: new Date().toISOString(), evolution_log: log }).eq('id', old.id);
            updated++;
          } else {
            const { error: insErr } = await supabase.from('agent_beliefs').insert({
              agent_call_sign: callSign,
              hypothesis: belief.hypothesis,
              belief_type: belief.belief_type || 'pattern',
              confidence: belief.confidence,
              supporting_entry_ids: agentEntries.slice(0, 4).map(e => e.id),
              related_domains: [...new Set(agentEntries.map(e => e.domain).filter(Boolean))],
              evolution_log: [{ date: new Date().toISOString(), old_confidence: null, new_confidence: belief.confidence, reason: 'Initial belief formed' }],
            });
            if (!insErr) created++;
            else return { callSign, status: `insert_error:${insErr.message}` };
          }
        }

        beliefsCreated += created;
        beliefsUpdated += updated;
        return { callSign, status: 'ok', created, updated, total_beliefs: beliefs.length };
      }));

      if (debug) {
        results.forEach((r, idx) => {
          const key = batch[idx];
          diagnostics[key] = r.status === 'fulfilled' ? r.value : { error: String(r.reason) };
        });
      }
    }

    // ── 2. CROSS-DOMAIN CONNECTIONS (batches of 4 agents) ────────────
    const connDebug: any[] = [];
    if (mode !== 'beliefs' && agentKeys.length >= 2) {
      const CROSS_BATCH = 4;

      for (let i = 0; i < agentKeys.length; i += CROSS_BATCH) {
        const batchAgents = agentKeys.slice(i, i + CROSS_BATCH);
        const batchEntries: typeof entries = [];
        for (const k of batchAgents) batchEntries.push(...(byAgent[k] || []).slice(0, 3));
        if (batchEntries.length < 4) continue;
        const dbg: any[] = [];
        connectionsCreated += await findAndStoreConnections(supabase, batchEntries, debug ? dbg : undefined);
        if (debug && dbg.length) connDebug.push({ batch: batchAgents.map(k => k.replace('agent:', '')), detail: dbg });
        // Only debug first batch to avoid response bloat
        if (debug && connDebug.length >= 1) break;
      }
    }

    const response: any = {
      message: 'Knowledge synthesis complete',
      entries_processed: entries.length,
      agents_synthesized: agentKeys.length,
      beliefs_created: beliefsCreated,
      beliefs_updated: beliefsUpdated,
      connections_created: connectionsCreated,
    };
    if (debug) { response.diagnostics = diagnostics; response.conn_debug = connDebug; }

    if (heartbeatId) {
      await supabase.from('cron_heartbeat').update({
        completed_at: new Date().toISOString(),
        status: 'succeeded',
        result_summary: {
          entries_processed: entries.length,
          agents_synthesized: agentKeys.length,
          beliefs_created: beliefsCreated,
          beliefs_updated: beliefsUpdated,
          connections_created: connectionsCreated,
        },
      }).eq('id', heartbeatId);
    }

    return successResponse(response);

  } catch (err) {
    console.error('[knowledge-synthesizer] Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    try {
      const supabase = createServiceClient();
      // heartbeatId not in scope here; insert a fresh failure row
      await supabase.from('cron_heartbeat').insert({
        job_name: 'knowledge-synthesizer-nightly',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: 'failed',
        result_summary: { error: message },
      });
    } catch (_) {}
    return errorResponse(message, 500);
  }
});

async function extractAgentBeliefs(
  callSign: string,
  entries: any[]
): Promise<{ beliefs: any[]; rawContent: string | null; geminiError: string | null }> {
  const entrySummaries = entries
    .map(e => `[${(e.subdomain || e.knowledge_type || 'knowledge').toUpperCase()}] ${e.title}\n${e.content.substring(0, 260)}`)
    .join('\n\n');

  const result = await callAiGateway({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are an intelligence analyst. Extract 3-5 analytical BELIEFS from this agent's knowledge base.

Beliefs are conclusions, not facts. Good: "AI-driven tools compress attacker dwell time to under 48h, making reactive defense insufficient." Bad: "Cyber threats are growing."

Respond with ONLY a JSON array, no other text:
[{"hypothesis":"...","belief_type":"threat_model|pattern|actor_assessment|geographic_risk|tactical_insight","confidence":0.85}]`,
      },
      {
        role: 'user',
        content: `Agent ${callSign}:\n\n${entrySummaries.substring(0, 4000)}`,
      },
    ],
    functionName: `knowledge-synthesizer-beliefs-${callSign}`,
    retries: 1,
    extraBody: { max_tokens: 2000 },
    skipGuardrails: true,
  });

  if (result.error || !result.content) {
    return { beliefs: [], rawContent: null, geminiError: result.error };
  }

  const beliefs = extractJsonArray(result.content);
  return { beliefs: beliefs.slice(0, 5), rawContent: result.content, geminiError: null };
}

async function findAndStoreConnections(supabase: any, batchEntries: any[], debugOut?: any[]): Promise<number> {
  const entryList = batchEntries
    .map((e, i) =>
      `[${i}] ${e.expert_name?.replace('agent:', '')} | ${e.domain}\n${e.title}\n${e.content.substring(0, 130)}`
    )
    .join('\n\n---\n\n');

  const result = await callAiGateway({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Find 2-3 non-obvious cross-domain connections between these entries from DIFFERENT agents. Only include connections where the combined insight reveals something neither domain saw alone.

Reference entries by index numbers (0, 1, 2, etc.). Keep synthesis_note under 50 words.

Return a JSON object with a "connections" array:
{"connections":[{"source_index":0,"target_index":3,"relationship_type":"cross_domain","synthesis_note":"...","agents_involved":["A","B"],"strength":0.75}]}`,
      },
      {
        role: 'user',
        content: `Entries:\n\n${entryList.substring(0, 3500)}`,
      },
    ],
    functionName: 'knowledge-synthesizer-connections',
    retries: 1,
    extraBody: { max_tokens: 4096, response_format: { type: 'json_object' } },
    skipGuardrails: true,
  });

  if (result.error || !result.content) {
    if (debugOut) debugOut.push({ error: result.error, note: 'gemini_fail' });
    return 0;
  }

  let parsed: any;
  try { parsed = JSON.parse(result.content); } catch { parsed = null; }
  const connections: any[] = parsed?.connections ?? extractJsonArray(result.content);
  if (debugOut) debugOut.push({ raw: result.content.substring(0, 600), parsed_count: connections.length, batch_size: batchEntries.length });
  let stored = 0;

  for (const conn of connections) {
    const src = batchEntries[conn.source_index];
    const tgt = batchEntries[conn.target_index];
    if (!src || !tgt || src.id === tgt.id) { if (debugOut) debugOut.push({ skip: 'index_miss', si: conn.source_index, ti: conn.target_index, len: batchEntries.length }); continue; }
    if (src.expert_name === tgt.expert_name) { if (debugOut) debugOut.push({ skip: 'same_agent' }); continue; }

    const { error } = await supabase.from('knowledge_connections').insert({
      source_entry_id: src.id,
      target_entry_id: tgt.id,
      relationship_type: conn.relationship_type || 'cross_domain',
      synthesis_note: conn.synthesis_note,
      agents_involved: conn.agents_involved || [
        src.expert_name?.replace('agent:', ''),
        tgt.expert_name?.replace('agent:', ''),
      ].filter(Boolean),
      connection_strength: conn.strength ?? 0.7,
    });
    if (!error) stored++;
  }
  return stored;
}

function extractJsonArray(text: string): any[] {
  if (!text) return [];
  // Direct parse
  try { const p = JSON.parse(text.trim()); if (Array.isArray(p)) return p; } catch {}
  // Strip code fences
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/gi, '').trim();
  try { const p = JSON.parse(stripped); if (Array.isArray(p)) return p; } catch {}
  // Extract first [...] block
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try { const p = JSON.parse(text.slice(start, end + 1)); if (Array.isArray(p)) return p; } catch {}
  }
  return [];
}
