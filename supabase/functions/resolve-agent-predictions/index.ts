/**
 * resolve-agent-predictions
 *
 * Nightly job that closes the loop on predictions agents made via the
 * `emit_prediction` tool. For every prediction whose `expected_by` has
 * elapsed and is still `status = 'pending'`:
 *
 *   1. Search for evidence in the database that matches its
 *      `triggering_conditions` (confirmed) or `falsifying_conditions`
 *      (refuted). Evidence sources: signals + incidents + entity_mentions
 *      since the prediction was created.
 *   2. Use an AI judge to compare the evidence to the prediction text
 *      and rule confirmed | refuted | inconclusive.
 *   3. Update prediction row status + confirmed_at/refuted_at +
 *      confirmation_signal_id where applicable.
 *   4. Update agent_calibration_scores with the new outcome — this is
 *      the bidirectional calibration loop (rewards correct calls, not
 *      just penalising overconfidence).
 *
 * Without this resolver, agent_world_predictions stays at 0 rows forever
 * (the situation 2026-04-30) and there is no way to measure whether
 * agents are actually getting better.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
import { recordTelemetry } from "../_shared/observability.ts";

const BATCH_SIZE = 25;
const RUN_TIMEOUT_MS = 110_000;

interface PredictionRow {
  id: string;
  agent_call_sign: string;
  prediction_text: string;
  domain: string;
  confidence_probability: number;
  triggering_conditions: string[] | null;
  falsifying_conditions: string[] | null;
  related_signal_id: string | null;
  related_incident_id: string | null;
  client_id: string | null;
  created_at: string;
  expected_by: string;
}

interface ResolverVerdict {
  outcome: 'confirmed' | 'refuted' | 'inconclusive';
  reasoning: string;
  evidence_signal_id?: string | null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'resolve-agent-predictions-nightly');
  const runStartedAt = Date.now();
  let resolved = 0;
  let confirmed = 0;
  let refuted = 0;
  let inconclusive = 0;

  try {
    // ── 1. Pull due predictions ───────────────────────────────────────────
    const { data: due, error: fetchError } = await supabase
      .from('agent_world_predictions')
      .select('id, agent_call_sign, prediction_text, domain, confidence_probability, triggering_conditions, falsifying_conditions, related_signal_id, related_incident_id, client_id, created_at, expected_by')
      .eq('status', 'pending')
      .lte('expected_by', new Date().toISOString())
      .order('expected_by', { ascending: true })
      .limit(BATCH_SIZE);
    if (fetchError) throw fetchError;
    if (!due || due.length === 0) {
      await completeHeartbeat(supabase, hb, { resolved: 0, confirmed: 0, refuted: 0, inconclusive: 0 });
      return successResponse({ message: 'No predictions due for resolution', resolved: 0 });
    }

    // ── 2. For each prediction, gather evidence + ask judge ───────────────
    for (const p of due as PredictionRow[]) {
      if (Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
        console.log('[resolver] Run budget exhausted — yielding to next tick');
        break;
      }

      const verdict = await judgePrediction(supabase, p);

      const updateRow: Record<string, unknown> = {
        status: verdict.outcome === 'inconclusive' ? 'inconclusive' :
                verdict.outcome === 'confirmed' ? 'confirmed' : 'refuted',
        updated_at: new Date().toISOString(),
      };
      if (verdict.outcome === 'confirmed') {
        updateRow.confirmed_at = new Date().toISOString();
        updateRow.confirmation_signal_id = verdict.evidence_signal_id ?? null;
      } else if (verdict.outcome === 'refuted') {
        updateRow.refuted_at = new Date().toISOString();
      }

      const { error: updateError } = await supabase
        .from('agent_world_predictions')
        .update(updateRow)
        .eq('id', p.id);
      if (updateError) {
        console.warn(`[resolver] Failed to update prediction ${p.id}:`, updateError.message);
        continue;
      }

      resolved++;
      if (verdict.outcome === 'confirmed') confirmed++;
      else if (verdict.outcome === 'refuted') refuted++;
      else inconclusive++;

      // ── 3. Update calibration score for this agent+domain ───────────────
      await updateCalibration(supabase, p, verdict);
    }

    await completeHeartbeat(supabase, hb, { resolved, confirmed, refuted, inconclusive });
    await recordTelemetry(supabase, {
      functionName: 'resolve-agent-predictions',
      durationMs: Date.now() - runStartedAt,
      status: 'success',
      context: { resolved, confirmed, refuted, inconclusive },
    });

    return successResponse({ resolved, confirmed, refuted, inconclusive });
  } catch (error) {
    console.error('[resolver] Fatal:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ── Judge ──────────────────────────────────────────────────────────────────

async function judgePrediction(supabase: any, p: PredictionRow): Promise<ResolverVerdict> {
  // Gather evidence: signals/incidents created after the prediction was made.
  const sinceIso = p.created_at;
  const [{ data: signals }, { data: incidents }] = await Promise.all([
    supabase.from('signals')
      .select('id, title, normalized_text, severity, created_at')
      .gte('created_at', sinceIso)
      .is('deleted_at', null)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('incidents')
      .select('id, title, summary, priority, status, opened_at')
      .gte('opened_at', sinceIso)
      .order('opened_at', { ascending: false })
      .limit(10),
  ]);

  const evidence = JSON.stringify({
    signals: (signals ?? []).map((s: any) => ({
      id: s.id,
      title: (s.title || '').substring(0, 120),
      severity: s.severity,
      excerpt: (s.normalized_text || '').substring(0, 200),
    })),
    incidents: (incidents ?? []).map((i: any) => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
      status: i.status,
    })),
  }).substring(0, 6000);

  const ai = await callAiGatewayJson<ResolverVerdict>({
    model: 'openai/gpt-5.2',
    functionName: 'resolve-agent-predictions',
    messages: [
      {
        role: 'system',
        content: `You are a strict prediction-resolution judge. Given a prediction made by a security AI agent and the evidence available now, decide CONFIRMED, REFUTED, or INCONCLUSIVE.\n\nRules:\n- CONFIRMED: A triggering_condition is clearly met by the evidence.\n- REFUTED: A falsifying_condition is clearly met OR the prediction's claim is contradicted by evidence.\n- INCONCLUSIVE: Insufficient evidence either way. Be honest — prefer inconclusive over a guess.\n- If you confirm based on a specific signal, return its id as evidence_signal_id.\n\nReturn JSON: {"outcome": "confirmed"|"refuted"|"inconclusive", "reasoning": "1-2 sentences", "evidence_signal_id": "uuid or null"}`,
      },
      {
        role: 'user',
        content: `Prediction by ${p.agent_call_sign} (${p.domain}, confidence ${p.confidence_probability}):\n"${p.prediction_text}"\n\nTriggering (would confirm): ${JSON.stringify(p.triggering_conditions || [])}\nFalsifying (would refute): ${JSON.stringify(p.falsifying_conditions || [])}\n\nMade at: ${p.created_at}\nExpected by: ${p.expected_by}\n\nEvidence available since prediction was made:\n${evidence}`,
      },
    ],
    extraBody: { response_format: { type: 'json_object' } },
    retries: 1,
  });

  if (ai.error || !ai.data) {
    console.warn(`[resolver] Judge error for ${p.id}: ${ai.error}`);
    return { outcome: 'inconclusive', reasoning: `Judge call failed: ${ai.error}` };
  }
  return ai.data;
}

// ── Calibration update ────────────────────────────────────────────────────

async function updateCalibration(supabase: any, p: PredictionRow, verdict: ResolverVerdict) {
  // Brier-score formula: (probability - actual_outcome)^2.
  // INCONCLUSIVE skipped — we only update on hits/misses.
  if (verdict.outcome === 'inconclusive') return;
  const actual = verdict.outcome === 'confirmed' ? 1 : 0;
  const prob = Number(p.confidence_probability) || 0;
  const brierForThis = Math.pow(prob - actual, 2);

  // Look up existing row for this agent+domain
  const { data: existing } = await supabase
    .from('agent_calibration_scores')
    .select('id, total_predictions, correct_predictions, brier_score, calibration_score')
    .eq('call_sign', p.agent_call_sign)
    .eq('domain', p.domain)
    .maybeSingle();

  if (existing) {
    const newTotal = (existing.total_predictions || 0) + 1;
    const newCorrect = (existing.correct_predictions || 0) + actual;
    // Running mean of brier
    const oldBrier = Number(existing.brier_score) || 0;
    const newBrier = ((oldBrier * (existing.total_predictions || 0)) + brierForThis) / newTotal;
    // Calibration score = 1 - mean(brier). Higher is better, 1.0 = perfect.
    const newCalibration = Math.max(0, 1 - newBrier);
    await supabase
      .from('agent_calibration_scores')
      .update({
        total_predictions: newTotal,
        correct_predictions: newCorrect,
        brier_score: newBrier,
        calibration_score: newCalibration,
        last_evaluated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('agent_calibration_scores').insert({
      call_sign: p.agent_call_sign,
      domain: p.domain,
      total_predictions: 1,
      correct_predictions: actual,
      brier_score: brierForThis,
      calibration_score: Math.max(0, 1 - brierForThis),
      last_prediction_at: p.created_at,
      last_evaluated_at: new Date().toISOString(),
    });
  }
}
