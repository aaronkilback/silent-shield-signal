/**
 * synthesize-entity-narratives
 *
 * For each actively-monitored entity that has been mentioned in ≥2 signals
 * in the last 30 days, generates a "DEDUCTION-style" narrative belief that
 * ties the recurring pattern together. This is the synthesis layer the
 * 3Si Apr 17 audit found missing — Fortress had matching signals but
 * never connected them into "increased reputational pressure on Phase 2"
 * style conclusions.
 *
 * Outputs an `agent_beliefs` row per entity with belief_type='entity_narrative',
 * client_id = entity.client_id (when present), and an evolution_log entry
 * citing the contributing signals.
 *
 * Conservative defaults:
 *   - Top 20 entities by recent mention count per run (cost cap)
 *   - Only entities with active_monitoring_enabled = true
 *   - Off by default — set env ENTITY_NARRATIVE_ENABLED=true to run
 *   - Skips an entity if a narrative was generated in the last 24h (dedup)
 *
 * Cron: every 6h (synthesize-entity-narratives-6h).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

type EntityRow = {
  id: string;
  name: string;
  type: string | null;
  client_id: string | null;
  attributes: Record<string, unknown> | null;
};

const NARRATIVE_AGENT = 'AEGIS-CMD';
const RECENT_NARRATIVE_HOURS = 24;
const MENTION_WINDOW_DAYS = 30;
const MAX_ENTITIES_PER_RUN = 20;
const MIN_MENTIONS = 2;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (Deno.env.get('ENTITY_NARRATIVE_ENABLED') !== 'true') {
      return successResponse({
        skipped: true,
        reason: 'feature flag ENTITY_NARRATIVE_ENABLED is not "true"',
      });
    }

    const supabase = createServiceClient();
    const since = new Date(Date.now() - MENTION_WINDOW_DAYS * 86400000).toISOString();

    // ── 1. Find entities with recurring mentions in the window ─────────────
    const { data: mentionRows, error: mentionsErr } = await supabase
      .from('entity_mentions')
      .select('entity_id, signal_id, created_at')
      .gte('created_at', since)
      .not('signal_id', 'is', null);

    if (mentionsErr) {
      console.error('[narratives] entity_mentions fetch failed:', mentionsErr);
      return errorResponse('failed to fetch entity_mentions', 500);
    }

    // Aggregate per entity
    const byEntity = new Map<string, string[]>();
    for (const m of (mentionRows ?? [])) {
      const arr = byEntity.get(m.entity_id) ?? [];
      arr.push(m.signal_id);
      byEntity.set(m.entity_id, arr);
    }

    // Top-N entities with ≥ MIN_MENTIONS, sorted by mention count desc
    const candidates = [...byEntity.entries()]
      .filter(([, sigs]) => sigs.length >= MIN_MENTIONS)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_ENTITIES_PER_RUN);

    if (candidates.length === 0) {
      return successResponse({ entities_considered: 0, narratives_written: 0 });
    }

    // ── 2. Load entity rows (active_monitoring_enabled only) ──────────────
    const entityIds = candidates.map(([id]) => id);
    const { data: entities } = await supabase
      .from('entities')
      .select('id, name, type, client_id, attributes')
      .in('id', entityIds)
      .eq('active_monitoring_enabled', true);

    const entityMap = new Map<string, EntityRow>();
    for (const e of (entities ?? [])) entityMap.set(e.id, e as EntityRow);

    let narrativesWritten = 0;
    let narrativesUpdated = 0;
    const skipped: string[] = [];

    // ── 3. For each entity, dedupe + synthesize ───────────────────────────
    for (const [entityId, signalIds] of candidates) {
      const ent = entityMap.get(entityId);
      if (!ent) {
        skipped.push(`${entityId}:not_actively_monitored`);
        continue;
      }

      // Dedup: skip if a narrative was generated for this entity in the last 24h.
      // We identify a narrative by matching belief_type='entity_narrative' with
      // hypothesis containing the entity name (substring match — narratives are
      // sentence-length strings).
      const recentCutoff = new Date(Date.now() - RECENT_NARRATIVE_HOURS * 3600000).toISOString();
      const { data: recent } = await supabase
        .from('agent_beliefs')
        .select('id')
        .eq('belief_type', 'entity_narrative')
        .ilike('hypothesis', `%${ent.name.replace(/[%_]/g, ' ').slice(0, 60)}%`)
        .gte('last_updated_at', recentCutoff)
        .limit(1);
      if (recent && recent.length > 0) {
        skipped.push(`${ent.name}:fresh_narrative_exists`);
        continue;
      }

      // Pull contributing signals
      const { data: sigs } = await supabase
        .from('signals')
        .select('id, title, normalized_text, severity, category, created_at, source_url')
        .in('id', signalIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!sigs || sigs.length < MIN_MENTIONS) {
        skipped.push(`${ent.name}:insufficient_signals`);
        continue;
      }

      // Pull prior beliefs about this entity (if any) for context
      const { data: priorBeliefs } = await supabase
        .from('agent_beliefs')
        .select('hypothesis, confidence')
        .ilike('hypothesis', `%${ent.name.replace(/[%_]/g, ' ').slice(0, 60)}%`)
        .order('last_updated_at', { ascending: false })
        .limit(5);

      // Build prompt
      const sigList = sigs.map((s, i) => {
        const ts = new Date(s.created_at).toISOString().slice(0, 10);
        const txt = (s.normalized_text || s.title || '').slice(0, 220);
        return `[${i + 1}] ${ts} | ${s.severity || '?'} | ${s.category || '?'} | ${txt}`;
      }).join('\n');

      const priorList = (priorBeliefs ?? []).map((b: any, i: number) =>
        `[prior ${i + 1}] (conf=${b.confidence}) ${String(b.hypothesis).slice(0, 200)}`
      ).join('\n');

      const userPrompt =
        `Entity: ${ent.name} (type: ${ent.type || 'unknown'})\n` +
        `Mentions in last ${MENTION_WINDOW_DAYS} days: ${sigList.length} signals\n\n` +
        `RECENT SIGNALS:\n${sigList}\n\n` +
        (priorList ? `PRIOR ANALYTICAL BELIEFS:\n${priorList}\n\n` : '') +
        `Synthesize a single-sentence narrative hypothesis (≤ 35 words) describing ` +
        `the emerging pattern this entity exhibits and why it matters. Cite the strongest 2 signals by their bracket numbers.\n\n` +
        `Respond with strict JSON: {"hypothesis": "...", "confidence": 0.0-1.0, "primary_signal_indices": [1,2]}`;

      const { data: aiData, error: aiErr } = await callAiGatewayJson({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are AEGIS-CMD, the protective-intelligence command analyst. Produce DEDUCTION-style ` +
              `narrative hypotheses that connect recurring signals into a single emerging pattern. Be conservative ` +
              `with confidence — only assert above 0.75 when at least 4 distinct signals point to the same conclusion. ` +
              `If signals are mixed or sparse, return confidence ≤ 0.55. Always respond with strict JSON.`,
          },
          { role: 'user', content: userPrompt },
        ],
        functionName: 'synthesize-entity-narratives',
      });

      if (aiErr || !aiData?.hypothesis) {
        skipped.push(`${ent.name}:ai_error:${aiErr?.message || 'no hypothesis'}`);
        continue;
      }

      const hypothesis = String(aiData.hypothesis).slice(0, 500);
      const confidence = Math.max(0, Math.min(1, Number(aiData.confidence) || 0.5));
      const primaryIdx: number[] = Array.isArray(aiData.primary_signal_indices)
        ? aiData.primary_signal_indices.filter((n: any) => typeof n === 'number')
        : [];

      const evolutionEntry = {
        date: new Date().toISOString(),
        old_confidence: null,
        new_confidence: confidence,
        reason: `Entity narrative from ${sigs.length} signals over ${MENTION_WINDOW_DAYS}d`,
        contributing_signal_ids: sigs.slice(0, 10).map((s: any) => s.id),
        primary_signal_indices: primaryIdx,
      };

      // Upsert: match by (agent_call_sign, client_id, hypothesis prefix)
      const { data: existing } = await supabase
        .from('agent_beliefs')
        .select('id, confidence, evolution_log')
        .eq('agent_call_sign', NARRATIVE_AGENT)
        .eq('belief_type', 'entity_narrative')
        .ilike('hypothesis', `%${ent.name.slice(0, 40).replace(/[%_]/g, ' ')}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        const old = existing[0];
        const newConf = Math.round(((old.confidence * 0.6) + (confidence * 0.4)) * 100) / 100;
        const log = [...(old.evolution_log || []), evolutionEntry];
        await supabase
          .from('agent_beliefs')
          .update({
            hypothesis,
            confidence: newConf,
            last_updated_at: new Date().toISOString(),
            evolution_log: log,
          })
          .eq('id', old.id);
        narrativesUpdated++;
      } else {
        await supabase
          .from('agent_beliefs')
          .insert({
            agent_call_sign: NARRATIVE_AGENT,
            hypothesis,
            belief_type: 'entity_narrative',
            confidence,
            related_domains: ['narrative', String(ent.type || 'entity')],
            client_id: ent.client_id ?? null,
            evolution_log: [evolutionEntry],
          });
        narrativesWritten++;
      }
    }

    return successResponse({
      entities_considered: candidates.length,
      narratives_written: narrativesWritten,
      narratives_updated: narrativesUpdated,
      skipped_count: skipped.length,
      skipped: skipped.slice(0, 30),
    });
  } catch (err) {
    console.error('[synthesize-entity-narratives] error:', err);
    return errorResponse(err instanceof Error ? err.message : 'unknown', 500);
  }
});
