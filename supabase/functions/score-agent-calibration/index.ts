/**
 * score-agent-calibration
 *
 * Closes the agent learning loop. Walks resolved signals, grades each
 * agent's prior confidence_score against the actual outcome
 * (resolved=1, false_positive=0), and persists per-agent / per-domain
 * Brier + calibration scores into agent_calibration_scores.
 *
 * Why this exists:
 *   The Fortress fleet has been forming beliefs (~5,800/wk across 42
 *   agents) and emitting confidence numbers, but nothing scored those
 *   numbers against ground truth. agent_calibration_scores was empty.
 *   That meant a chronically over-confident agent and a well-calibrated
 *   one looked identical to the rest of the system.
 *
 * Algorithm — full rebuild from a 90-day window on each run:
 *   1. Pull every resolved/false_positive signal whose `updated_at` is
 *      inside the rolling 90-day window, joined to its specialist
 *      analyses with non-null confidence_score.
 *   2. Filter to call_signs that match an active ai_agents row
 *      (excludes pseudo-agents like TIER2-REVIEW and AI-DECISION-ENGINE
 *      whose rows in signal_agent_analyses represent gate decisions,
 *      not specialist predictions).
 *   3. For each (call_sign, domain=signal.category) bucket, compute:
 *        n           — count of distinct (signal_id, call_sign) pairs
 *        brier_score — mean of (confidence - outcome)^2
 *        accuracy    — fraction where (confidence>=0.5) == (outcome==1)
 *   4. Replace the table contents with the rebuilt rows. No incremental
 *      merge — that risked double-counting because the same resolved
 *      signal could be re-scored on consecutive daily runs.
 *
 * The 90-day window is the calibration horizon: bad weeks fade out
 * after ~3 months, but accumulated evidence converges over the same
 * period. At current resolution volume (~60 signals/30d), this gives
 * roughly 180 graded predictions to anchor a fleet of 42 agents — thin
 * but meaningful, and it grows with operator throughput.
 *
 * Scheduling: invoked daily at 04:00 UTC by pg_cron (see
 * 20260510000003_schedule_score_agent_calibration.sql).
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const JOB_NAME = "score-agent-calibration-daily";
const WINDOW_DAYS = 90;

interface AnalysisRow {
  agent_call_sign: string;
  confidence_score: number;
  signal_id: string;
  signal_status: string;
  signal_category: string | null;
  signal_updated_at: string;
}

interface Bucket {
  n: number;
  sum_brier: number;
  sum_correct: number;
  last_prediction_at: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB_NAME);

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("signal_agent_analyses")
      .select(`
        agent_call_sign,
        confidence_score,
        signal_id,
        signals!inner ( status, category, updated_at )
      `)
      .not("confidence_score", "is", null)
      .gte("signals.updated_at", since)
      .in("signals.status", ["resolved", "false_positive"]);

    if (error) {
      throw new Error(`Failed to fetch analyses: ${error.message}`);
    }

    const flat: AnalysisRow[] = (rows ?? []).map((r: any) => ({
      agent_call_sign: r.agent_call_sign,
      confidence_score: Number(r.confidence_score),
      signal_id: r.signal_id,
      signal_status: r.signals.status,
      signal_category: r.signals.category ?? "unknown",
      signal_updated_at: r.signals.updated_at,
    }));

    const { data: activeAgents } = await supabase
      .from("ai_agents")
      .select("call_sign")
      .eq("is_active", true);
    const specialistSet = new Set((activeAgents ?? []).map((a: any) => a.call_sign));

    // Dedup (signal_id, call_sign) — if a single agent wrote multiple
    // analyses for the same signal, count them once. The most-recent
    // confidence wins (last write reflects the agent's final view).
    const dedup = new Map<string, AnalysisRow>();
    for (const r of flat) {
      if (!specialistSet.has(r.agent_call_sign)) continue;
      const key = `${r.signal_id}::${r.agent_call_sign}`;
      const cur = dedup.get(key);
      if (!cur || r.signal_updated_at > cur.signal_updated_at) {
        dedup.set(key, r);
      }
    }
    const eligible = Array.from(dedup.values());

    const buckets = new Map<string, Bucket>();
    for (const r of eligible) {
      const conf = clamp01(r.confidence_score);
      const outcome = r.signal_status === "resolved" ? 1 : 0;
      const correct = (conf >= 0.5 ? 1 : 0) === outcome ? 1 : 0;
      const brier = (conf - outcome) ** 2;

      const key = `${r.agent_call_sign}::${r.signal_category}`;
      const cur = buckets.get(key);
      if (cur) {
        cur.n += 1;
        cur.sum_brier += brier;
        cur.sum_correct += correct;
        if (r.signal_updated_at > cur.last_prediction_at) {
          cur.last_prediction_at = r.signal_updated_at;
        }
      } else {
        buckets.set(key, {
          n: 1,
          sum_brier: brier,
          sum_correct: correct,
          last_prediction_at: r.signal_updated_at,
        });
      }
    }

    const upserts: Array<Record<string, unknown>> = [];
    for (const [key, b] of buckets) {
      const [call_sign, domain] = key.split("::");
      upserts.push({
        call_sign,
        domain,
        total_predictions: b.n,
        correct_predictions: b.sum_correct,
        brier_score: round3(b.sum_brier / b.n),
        calibration_score: round3(b.sum_correct / b.n),
        last_prediction_at: b.last_prediction_at,
        last_evaluated_at: new Date().toISOString(),
      });
    }

    // Replace table contents — full rebuild semantics. Truncate first
    // so stale (call_sign, domain) buckets that drop out of the 90-day
    // window get removed instead of frozen at their last value.
    const { error: delErr } = await supabase
      .from("agent_calibration_scores")
      .delete()
      .gte("total_predictions", 0);
    if (delErr) {
      throw new Error(`Failed to clear table: ${delErr.message}`);
    }

    if (upserts.length > 0) {
      const { error: insErr } = await supabase
        .from("agent_calibration_scores")
        .insert(upserts);
      if (insErr) {
        throw new Error(`Insert failed: ${insErr.message}`);
      }
    }

    const summary = {
      window_days: WINDOW_DAYS,
      analyses_scored: eligible.length,
      buckets_updated: upserts.length,
      distinct_agents: new Set(eligible.map((e) => e.agent_call_sign)).size,
    };

    await completeHeartbeat(supabase, hb, summary);
    console.log(`[score-agent-calibration] ${JSON.stringify(summary)}`);
    return successResponse(summary);
  } catch (err) {
    await failHeartbeat(supabase, hb, err);
    console.error("[score-agent-calibration] Error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
