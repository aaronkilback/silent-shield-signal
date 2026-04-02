/**
 * propagate-knowledge-edges
 *
 * Cross-agent knowledge propagation. When an agent learns something significant,
 * relevant insights are shared with semantically related agents.
 *
 * Invoked by cron (every 2 hours) or manually.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { routeToAgents } from "../_shared/semantic-rag.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const { hours_lookback = 24 } = body;

    const supabase = createServiceClient();
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    const since = new Date(Date.now() - hours_lookback * 3600 * 1000).toISOString();

    // ── 1. Load significant memories from the lookback window ───────────────
    const { data: memories, error: memErr } = await supabase
      .from('agent_investigation_memory')
      .select('id, call_sign, content, confidence')
      .gte('created_at', since)
      .or('is_significant.eq.true,confidence.gt.0.8');

    if (memErr) {
      console.error('[propagate-knowledge-edges] Failed to load memories:', memErr);
      return errorResponse('Failed to load memories', 500);
    }

    if (!memories || memories.length === 0) {
      return successResponse({ connections_created: 0, memories_processed: 0 });
    }

    let connectionsCreated = 0;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString();

    for (const memory of memories) {
      const sourceCallSign: string = memory.call_sign;
      const memorySummary: string = (memory.content || '').substring(0, 500);

      if (!sourceCallSign || !memorySummary) continue;

      // ── 2. Find the 3 most related agents (excluding source) ─────────────
      const relatedAgents = await routeToAgents(supabase, memorySummary, openAiApiKey, 4);

      const candidates = relatedAgents.filter(
        (r) => r.call_sign !== sourceCallSign && r.similarity > 0.6
      ).slice(0, 3);

      for (const candidate of candidates) {
        const targetCallSign = candidate.call_sign;

        // ── 3. Check for a recent connection between this agent pair ────────
        const { data: existing, error: existErr } = await supabase
          .from('knowledge_connections')
          .select('id')
          .contains('agents_involved', [sourceCallSign, targetCallSign])
          .gte('created_at', oneDayAgo)
          .limit(1);

        if (existErr) {
          console.error(`[propagate-knowledge-edges] Existence check failed for ${sourceCallSign}->${targetCallSign}:`, existErr);
          continue;
        }

        if (existing && existing.length > 0) {
          // Already connected within the last 24 hours — skip
          continue;
        }

        // Also check if there was already one within 7 days (same pair, same direction)
        const { data: recentWeek } = await supabase
          .from('knowledge_connections')
          .select('id')
          .contains('agents_involved', [sourceCallSign, targetCallSign])
          .gte('created_at', sevenDaysAgo)
          .limit(1);

        // Allow at most 1 propagation per agent pair per day (already checked above)
        // but also skip if same pair already connected today

        // ── 4. Insert the knowledge connection ──────────────────────────────
        const { error: insertErr } = await supabase
          .from('knowledge_connections')
          .insert({
            agents_involved: [sourceCallSign, targetCallSign],
            synthesis_note: `Intelligence shared from ${sourceCallSign}: ${memorySummary}`,
            relationship_type: 'knowledge_propagation',
            connection_strength: candidate.similarity,
            domain: 'cross_agent',
          });

        if (insertErr) {
          console.error(
            `[propagate-knowledge-edges] Failed to insert connection ${sourceCallSign}->${targetCallSign}:`,
            insertErr
          );
        } else {
          connectionsCreated++;
          console.log(
            `[propagate-knowledge-edges] Propagated knowledge: ${sourceCallSign} -> ${targetCallSign} ` +
              `(similarity: ${Math.round(candidate.similarity * 100)}%)`
          );
        }
      }
    }

    console.log(
      `[propagate-knowledge-edges] Processed ${memories.length} memories, created ${connectionsCreated} connections`
    );

    return successResponse({
      connections_created: connectionsCreated,
      memories_processed: memories.length,
    });

  } catch (err) {
    console.error('[propagate-knowledge-edges] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
