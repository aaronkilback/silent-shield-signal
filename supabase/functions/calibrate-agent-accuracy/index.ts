import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { logError } from "../_shared/error-logger.ts";

/**
 * Calibrate Agent Accuracy
 * 
 * Aggregates agent_accuracy_tracking into agent_accuracy_metrics,
 * computing per-agent accuracy scores, confidence calibration,
 * and category-level breakdowns. Designed to run on a schedule (daily)
 * or on-demand.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    console.log('[calibrate-agent-accuracy] Starting calibration run...');

    // 1. Get all agents with resolved predictions
    const { data: agentStats, error: statsError } = await supabase
      .from('agent_accuracy_tracking')
      .select('agent_call_sign')
      .not('was_correct', 'is', null);

    if (statsError) throw statsError;

    // Deduplicate agent call signs
    const agents = [...new Set((agentStats || []).map(r => r.agent_call_sign))];

    if (agents.length === 0) {
      return successResponse({ message: 'No resolved predictions to calibrate', agents_calibrated: 0 });
    }

    console.log(`[calibrate-agent-accuracy] Calibrating ${agents.length} agents: ${agents.join(', ')}`);

    const results: Record<string, any> = {};

    for (const agent of agents) {
      // Fetch all resolved predictions for this agent
      const { data: predictions, error: predError } = await supabase
        .from('agent_accuracy_tracking')
        .select('prediction_type, prediction_value, confidence_at_prediction, was_correct, resolved_at')
        .eq('agent_call_sign', agent)
        .not('was_correct', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(500);

      if (predError || !predictions?.length) continue;

      const total = predictions.length;
      const correct = predictions.filter(p => p.was_correct).length;
      const accuracyScore = total > 0 ? correct / total : 0;

      // Category-level accuracy
      const categoryMap: Record<string, { total: number; correct: number }> = {};
      let totalConfidenceDelta = 0;
      let confidenceCount = 0;

      for (const pred of predictions) {
        const cat = pred.prediction_type || 'unknown';
        if (!categoryMap[cat]) categoryMap[cat] = { total: 0, correct: 0 };
        categoryMap[cat].total++;
        if (pred.was_correct) categoryMap[cat].correct++;

        // Confidence calibration: how far off is stated confidence from actual accuracy?
        if (pred.confidence_at_prediction != null) {
          const expectedOutcome = pred.was_correct ? 1 : 0;
          totalConfidenceDelta += Math.abs(pred.confidence_at_prediction - expectedOutcome);
          confidenceCount++;
        }
      }

      // Confidence calibration: 1.0 = perfectly calibrated, 0 = maximally miscalibrated
      const avgDelta = confidenceCount > 0 ? totalConfidenceDelta / confidenceCount : 0.5;
      const confidenceCalibration = Math.round((1 - avgDelta) * 100) / 100;

      const categoryAccuracy: Record<string, { accuracy: number; count: number }> = {};
      let strongest: string | null = null;
      let weakest: string | null = null;
      let bestAcc = -1;
      let worstAcc = 2;

      for (const [cat, stats] of Object.entries(categoryMap)) {
        const acc = stats.total > 0 ? stats.correct / stats.total : 0;
        categoryAccuracy[cat] = { accuracy: Math.round(acc * 100) / 100, count: stats.total };
        if (stats.total >= 3) { // Minimum sample size
          if (acc > bestAcc) { bestAcc = acc; strongest = cat; }
          if (acc < worstAcc) { worstAcc = acc; weakest = cat; }
        }
      }

      // Upsert into agent_accuracy_metrics
      const { error: upsertError } = await supabase
        .from('agent_accuracy_metrics')
        .upsert({
          agent_call_sign: agent,
          accuracy_score: Math.round(accuracyScore * 100) / 100,
          total_predictions: total,
          correct_predictions: correct,
          confidence_calibration: confidenceCalibration,
          category_accuracy: categoryAccuracy,
          strongest_category: strongest,
          weakest_category: weakest,
          last_calibrated: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'agent_call_sign' });

      if (upsertError) {
        console.error(`[calibrate-agent-accuracy] Upsert error for ${agent}:`, upsertError);
        // Fallback: try insert
        await supabase.from('agent_accuracy_metrics').insert({
          agent_call_sign: agent,
          accuracy_score: Math.round(accuracyScore * 100) / 100,
          total_predictions: total,
          correct_predictions: correct,
          confidence_calibration: confidenceCalibration,
          category_accuracy: categoryAccuracy,
          strongest_category: strongest,
          weakest_category: weakest,
          last_calibrated: new Date().toISOString(),
        });
      }

      results[agent] = {
        accuracy: `${(accuracyScore * 100).toFixed(1)}%`,
        total_predictions: total,
        correct_predictions: correct,
        confidence_calibration: confidenceCalibration,
        strongest_category: strongest,
        weakest_category: weakest,
      };

      console.log(`[calibrate-agent-accuracy] ${agent}: ${(accuracyScore * 100).toFixed(1)}% accuracy (${correct}/${total}), calibration: ${confidenceCalibration}`);
    }

    // Log the calibration session
    await supabase.from('agent_learning_sessions').insert({
      session_type: 'accuracy_calibration',
      learnings: { agents_calibrated: agents.length, results },
      source_count: agents.length,
      quality_score: 1.0,
    });

    // Log autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'accuracy_calibration',
      trigger_source: 'calibrate-agent-accuracy',
      action_details: { agents_calibrated: agents.length, results },
      status: 'completed',
    });

    console.log(`[calibrate-agent-accuracy] Complete. ${agents.length} agents calibrated.`);

    return successResponse({
      agents_calibrated: agents.length,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[calibrate-agent-accuracy] Error:', error);
    await logError(error, { functionName: 'calibrate-agent-accuracy', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
