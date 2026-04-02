/**
 * calibration-updater
 *
 * Updates agent Brier scores based on resolved debate predictions.
 * Invoked by cron (every 12 hours) or manually.
 *
 * Brier score = (probability - actual_outcome)^2
 * Lower is better; 0 = perfect, 1 = worst possible.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const { limit = 500 } = body;

    const supabase = createServiceClient();

    // ── 1. Load predictions that need Brier scoring ─────────────────────────
    const { data: predictions, error: predErr } = await supabase
      .from('debate_predictions')
      .select('id, agent_call_sign, confidence_probability, outcome_correct')
      .eq('outcome_verified', true)
      .is('brier_score', null)
      .limit(limit);

    if (predErr) {
      console.error('[calibration-updater] Failed to fetch predictions:', predErr);
      return errorResponse('Failed to fetch predictions', 500);
    }

    if (!predictions || predictions.length === 0) {
      return successResponse({ updated_predictions: 0, agents_updated: [] });
    }

    // ── 2. Compute and store Brier score for each prediction ────────────────
    const agentsAffected = new Set<string>();

    for (const pred of predictions) {
      const actualOutcome = pred.outcome_correct ? 1 : 0;
      const probability = pred.confidence_probability ?? 0.5;
      const brierScore = Math.pow(probability - actualOutcome, 2);

      const { error: updateErr } = await supabase
        .from('debate_predictions')
        .update({ brier_score: brierScore })
        .eq('id', pred.id);

      if (updateErr) {
        console.error(`[calibration-updater] Failed to update prediction ${pred.id}:`, updateErr);
      } else {
        agentsAffected.add(pred.agent_call_sign);
      }
    }

    // ── 3. Aggregate per-agent rolling mean Brier score (last 100 scored) ───
    const agentsUpdated: string[] = [];

    for (const callSign of agentsAffected) {
      const { data: recent, error: recentErr } = await supabase
        .from('debate_predictions')
        .select('brier_score')
        .eq('agent_call_sign', callSign)
        .not('brier_score', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (recentErr || !recent || recent.length === 0) {
        console.warn(`[calibration-updater] Could not load scored predictions for ${callSign}`);
        continue;
      }

      const scores = recent.map((r: any) => r.brier_score as number);
      const meanBrierScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const predictionsScored = scores.length;

      const { error: upsertErr } = await supabase
        .from('agent_calibration_scores')
        .upsert(
          {
            call_sign: callSign,
            brier_score_mean: Math.round(meanBrierScore * 10000) / 10000,
            predictions_scored: predictionsScored,
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sign' }
        );

      if (upsertErr) {
        console.error(`[calibration-updater] Failed to upsert calibration for ${callSign}:`, upsertErr);
      } else {
        agentsUpdated.push(callSign);
      }
    }

    console.log(
      `[calibration-updater] Updated ${predictions.length} predictions, ` +
        `recalibrated ${agentsUpdated.length} agents: ${agentsUpdated.join(', ')}`
    );

    return successResponse({
      updated_predictions: predictions.length,
      agents_updated: agentsUpdated,
    });

  } catch (err) {
    console.error('[calibration-updater] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
