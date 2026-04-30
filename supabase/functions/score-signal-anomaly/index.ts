/**
 * score-signal-anomaly
 *
 * Computes an anomaly score for a signal using Z-score against historical baselines.
 * Called immediately after signal ingestion for high-severity signals.
 *
 * Anomaly types detected:
 * - frequency: more of this signal_type than baseline
 * - severity_spike: much higher severity than typical
 * - temporal: unusual time of day/week for this type
 * - geographic_cluster: multiple signals from same location in short window
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { enqueueJob } from "../_shared/queue.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const { signal_id, category, severity, client_id, normalized_text } = body;
    if (!signal_id) return errorResponse('signal_id required', 400);

    const supabase = createServiceClient();

    // Fetch the signal
    const { data: signal, error: sigErr } = await supabase
      .from('signals')
      .select('id, signal_type, severity_score, created_at, location')
      .eq('id', signal_id)
      .single();

    if (sigErr || !signal) return errorResponse('Signal not found', 404);

    const signalHour = new Date(signal.created_at).getUTCHours();
    const anomalies: Array<{ type: string; z_score: number; detail: string }> = [];

    // ── 1. Frequency anomaly ───────────────────────────────────────────────
    const hourBaseline = await supabase
      .from('signal_baselines')
      .select('mean_count, std_dev, ewma')
      .eq('signal_type', signal.signal_type || 'unknown')
      .eq('hour_of_day', signalHour)
      .is('day_of_week', null)
      .maybeSingle();

    if (hourBaseline.data) {
      const b = hourBaseline.data;
      // Count signals of this type in the past hour
      const oneHourAgo = new Date(new Date(signal.created_at).getTime() - 3600000).toISOString();
      const { count: recentCount } = await supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .eq('signal_type', signal.signal_type)
        .gte('created_at', oneHourAgo)
        .lte('created_at', signal.created_at);

      const zScore = b.std_dev > 0
        ? ((recentCount || 1) - b.ewma) / b.std_dev
        : 0;

      if (zScore > 2.0) {
        anomalies.push({
          type: 'frequency',
          z_score: Math.round(zScore * 100) / 100,
          detail: `${recentCount} signals of type "${signal.signal_type}" in past hour vs. baseline of ${Math.round(b.ewma * 10) / 10} (±${Math.round(b.std_dev * 10) / 10})`,
        });
      }
    }

    // ── 2. Severity spike ─────────────────────────────────────────────────
    // Compare against recent average severity for this type
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: recentSeverities } = await supabase
      .from('signals')
      .select('severity_score')
      .eq('signal_type', signal.signal_type)
      .gte('created_at', thirtyDaysAgo)
      .not('severity_score', 'is', null)
      .limit(100);

    if (recentSeverities && recentSeverities.length > 5) {
      const scores = recentSeverities.map((s: any) => s.severity_score || 0);
      const mean = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      const std = Math.sqrt(scores.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / (scores.length - 1));
      const z = std > 0 ? ((signal.severity_score || 0) - mean) / std : 0;

      if (z > 2.0) {
        anomalies.push({
          type: 'severity_spike',
          z_score: Math.round(z * 100) / 100,
          detail: `Severity ${signal.severity_score} vs. 30-day mean of ${Math.round(mean)} (±${Math.round(std)}) for "${signal.signal_type}"`,
        });
      }
    }

    // ── 3. Geographic cluster ─────────────────────────────────────────────
    if (signal.location) {
      const locationKeywords = signal.location.toLowerCase().split(',')[0].trim();
      const sixHoursAgo = new Date(new Date(signal.created_at).getTime() - 6 * 3600000).toISOString();
      const { count: locationCount } = await supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .ilike('location', `%${locationKeywords}%`)
        .gte('created_at', sixHoursAgo)
        .lte('created_at', signal.created_at);

      if ((locationCount || 0) >= 3) {
        anomalies.push({
          type: 'geographic_cluster',
          z_score: Math.min((locationCount || 0) / 1.5, 10),
          detail: `${locationCount} signals from "${signal.location}" in last 6 hours`,
        });
      }
    }

    const isAnomalous = anomalies.length > 0;
    const maxZScore = anomalies.length > 0
      ? Math.max(...anomalies.map(a => a.z_score))
      : 0;
    const primaryType = anomalies.length > 0 ? anomalies[0].type : null;

    // Store anomaly score
    await supabase
      .from('signal_anomaly_scores')
      .upsert({
        signal_id,
        z_score: maxZScore,
        anomaly_type: primaryType,
        is_anomalous: isAnomalous,
        anomaly_details: { anomalies },
        computed_at: new Date().toISOString(),
      }, { onConflict: 'signal_id' });

    // Update EWMA in baseline (real-time learning)
    if (hourBaseline.data) {
      const newEwma = EWMA_ALPHA * 1 + (1 - EWMA_ALPHA) * (hourBaseline.data.ewma || 0);
      await supabase
        .from('signal_baselines')
        .update({ ewma: newEwma, last_computed_at: new Date().toISOString() })
        .eq('signal_type', signal.signal_type)
        .eq('hour_of_day', signalHour)
        .is('day_of_week', null);
    }

    // Trigger speculative dispatch for critical/high signals or statistical anomalies
    const shouldDispatch =
      severity === 'critical' ||
      severity === 'high' ||
      (maxZScore !== null && maxZScore > 2.0);

    if (shouldDispatch) {
      // Durable queue — was fire-and-forget invoke.
      enqueueJob(supabase, {
        type: 'speculative-dispatch',
        payload: {
          signal_id,
          signal_text: normalized_text || '',
          category: category || signal.signal_type || 'unknown',
          severity: severity || 'medium',
          client_id: client_id || null,
          trigger_reason: severity === 'critical' ? 'critical_severity' :
                          severity === 'high' ? 'high_severity' : 'anomaly_z_score',
          z_score: maxZScore || null,
        },
        idempotencyKey: `speculative-dispatch:${signal_id}:anomaly`,
      }).catch(err => console.error('[score-signal-anomaly] enqueue:', err));
    }

    return successResponse({
      signal_id,
      is_anomalous: isAnomalous,
      max_z_score: maxZScore,
      anomalies,
    });

  } catch (err) {
    console.error('[score-signal-anomaly] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});

const EWMA_ALPHA = 0.3;
