/**
 * compute-signal-baselines
 *
 * Computes rolling statistical baselines for signal frequency anomaly detection.
 * Runs nightly. Produces:
 * - Mean signal count per signal_type per hour_of_day
 * - Standard deviation
 * - EWMA (α=0.3) for recency weighting
 *
 * These baselines are used by score-signal-anomaly to flag unusual activity.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const EWMA_ALPHA = 0.3; // recency weight — higher = more sensitive to recent changes
const LOOKBACK_DAYS = 30;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();

    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

    // Fetch recent signals with their time components
    const { data: signals, error } = await supabase
      .from('signals')
      .select('id, signal_type, severity_score, created_at, location')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!signals?.length) return successResponse({ message: 'No signals to process', baselines: 0 });

    // Group by signal_type + hour_of_day
    const groups: Record<string, { counts: number[]; hourly: Record<number, number[]> }> = {};

    for (const signal of signals) {
      const type = signal.signal_type || 'unknown';
      const hour = new Date(signal.created_at).getUTCHours();

      if (!groups[type]) groups[type] = { counts: [], hourly: {} };
      if (!groups[type].hourly[hour]) groups[type].hourly[hour] = [];

      groups[type].counts.push(1);
      groups[type].hourly[hour].push(1);
    }

    let baselinesComputed = 0;

    for (const [signalType, data] of Object.entries(groups)) {
      // Overall baseline (null hour = aggregate)
      const totalCount = data.counts.length;
      const daysInSample = Math.min(LOOKBACK_DAYS, 30);
      const dailyMean = totalCount / daysInSample;
      const dailyStdDev = Math.sqrt(
        data.counts.reduce((sum) => sum + Math.pow(1 - dailyMean / daysInSample, 2), 0) / Math.max(data.counts.length - 1, 1)
      );

      await supabase
        .from('signal_baselines')
        .upsert({
          signal_type: signalType,
          hour_of_day: null,
          day_of_week: null,
          mean_count: dailyMean,
          std_dev: Math.max(dailyStdDev, 0.5), // min std_dev to avoid division by zero
          ewma: dailyMean, // seed with mean, EWMA updates in real-time
          sample_count: totalCount,
          last_computed_at: new Date().toISOString(),
        }, { onConflict: 'signal_type,hour_of_day,day_of_week' });

      baselinesComputed++;

      // Per-hour baselines
      for (const [hourStr, counts] of Object.entries(data.hourly)) {
        const hour = parseInt(hourStr);
        const n = counts.length;
        const meanPerDay = n / daysInSample;

        // Compute EWMA
        let ewma = meanPerDay;
        const alpha = EWMA_ALPHA;
        for (let i = 1; i < n; i++) {
          ewma = alpha * counts[i] + (1 - alpha) * ewma;
        }

        const variance = counts.reduce((sum, c) => sum + Math.pow(c - meanPerDay, 2), 0) / Math.max(n - 1, 1);
        const stdDev = Math.sqrt(variance);

        await supabase
          .from('signal_baselines')
          .upsert({
            signal_type: signalType,
            hour_of_day: hour,
            day_of_week: null,
            mean_count: meanPerDay,
            std_dev: Math.max(stdDev, 0.1),
            ewma,
            sample_count: n,
            last_computed_at: new Date().toISOString(),
          }, { onConflict: 'signal_type,hour_of_day,day_of_week' });

        baselinesComputed++;
      }
    }

    console.log(`[compute-signal-baselines] Computed ${baselinesComputed} baselines from ${signals.length} signals`);

    return successResponse({
      signals_analyzed: signals.length,
      baselines_computed: baselinesComputed,
      signal_types: Object.keys(groups).length,
    });

  } catch (err) {
    console.error('[compute-signal-baselines] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
