/**
 * calibration-updater
 *
 * Updates per-agent Brier and calibration scores in agent_calibration_scores
 * from resolved debate_predictions.
 *
 * Brier = (stated_confidence - actual_outcome)^2
 *   actual_outcome = 1 for outcome='confirmed', 0 for 'refuted',
 *                    outcome_confidence (or 0.5) for 'partial'
 *
 * Lower Brier is better. The orchestrator (self-improvement-orchestrator)
 * reads brier_score from this table and injects "## CALIBRATION CORRECTION"
 * blocks into agents' system_prompt for any agent with brier_score > 0.25.
 *
 * Schema note (rewritten 2026-04-29): agent_calibration_scores uses
 * `brier_score` and `total_predictions`, not `brier_score_mean` /
 * `predictions_scored`. Earlier code referenced the wrong columns and
 * silently failed every run. debate_predictions has no per-row brier_score
 * column, so we recompute the aggregate from all evaluated predictions
 * each run instead of caching per-prediction.
 *
 * Cron: every 12h (calibration-updater-12h).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();

    // Fetch all predictions that have a resolved outcome.
    const { data: predictions, error: predErr } = await supabase
      .from('debate_predictions')
      .select('call_sign, stated_confidence, outcome, outcome_confidence, domain')
      .in('outcome', ['confirmed', 'refuted', 'partial'])
      .not('stated_confidence', 'is', null);

    if (predErr) {
      console.error('[calibration-updater] Failed to fetch predictions:', predErr);
      return errorResponse('Failed to fetch predictions', 500);
    }

    if (!predictions || predictions.length === 0) {
      console.log('[calibration-updater] No resolved predictions to score');
      return successResponse({ agents_updated: 0, predictions_evaluated: 0 });
    }

    // Group by (call_sign, domain) so domain-specific calibration is preserved.
    type Bucket = { totals: number[]; correct: number; count: number; lastDomain: string | null };
    const buckets = new Map<string, Bucket>();

    const actualForOutcome = (outcome: string, outcomeConf: number | null): number => {
      if (outcome === 'confirmed') return 1;
      if (outcome === 'refuted') return 0;
      // partial — use outcome_confidence as the realised probability, default 0.5.
      return typeof outcomeConf === 'number' ? Math.max(0, Math.min(1, outcomeConf)) : 0.5;
    };

    for (const p of predictions) {
      if (!p.call_sign) continue;
      const stated = Math.max(0, Math.min(1, p.stated_confidence as number));
      const actual = actualForOutcome(p.outcome as string, (p.outcome_confidence as number | null) ?? null);
      const brier = Math.pow(stated - actual, 2);

      const key = `${p.call_sign}::${p.domain ?? ''}`;
      const b = buckets.get(key) ?? { totals: [], correct: 0, count: 0, lastDomain: p.domain ?? null };
      b.totals.push(brier);
      // Treat outcome 'confirmed' as correct, 'refuted' as wrong, 'partial' as half-credit.
      if (p.outcome === 'confirmed') b.correct += 1;
      else if (p.outcome === 'partial') b.correct += 0.5;
      b.count += 1;
      buckets.set(key, b);
    }

    let upsertedAgents = 0;
    const failures: string[] = [];

    for (const [key, b] of buckets) {
      const [callSign, rawDomain] = key.split('::');
      // Postgres treats NULL as distinct in unique constraints, so a NULL domain
      // would let duplicate (call_sign, NULL) rows accumulate on each run.
      // Default to 'general' so the unique constraint actually catches it.
      const domain = rawDomain || 'general';
      const meanBrier = b.totals.reduce((s, v) => s + v, 0) / b.totals.length;
      // calibration_score is "how well-calibrated" — invert Brier and clamp to [0,1].
      // Brier 0 → calibration 1; Brier 0.25 (random) → calibration 0.5; Brier 1 → 0.
      const calibration = Math.max(0, 1 - meanBrier * 2);

      const { error: upErr } = await supabase
        .from('agent_calibration_scores')
        .upsert(
          {
            call_sign: callSign,
            domain,
            total_predictions: b.count,
            correct_predictions: Math.round(b.correct),
            brier_score: Math.round(meanBrier * 10000) / 10000,
            calibration_score: Math.round(calibration * 10000) / 10000,
            last_evaluated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sign,domain' }
        );

      if (upErr) {
        failures.push(`${callSign}: ${upErr.message}`);
      } else {
        upsertedAgents++;
      }
    }

    console.log(
      `[calibration-updater] Evaluated ${predictions.length} predictions, upserted ${upsertedAgents} (call_sign, domain) buckets, ${failures.length} failures`
    );

    return successResponse({
      agents_updated: upsertedAgents,
      predictions_evaluated: predictions.length,
      failures,
    });

  } catch (err) {
    console.error('[calibration-updater] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
