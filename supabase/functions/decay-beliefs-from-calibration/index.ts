/**
 * decay-beliefs-from-calibration
 *
 * Closes the loop that was missing: agent_beliefs accumulate ~120
 * snapshots/agent/week but only 0.86% ever evolve past their initial
 * write. Beliefs are read-once knowledge dumps with no consequence for
 * being wrong. This job uses the agent_calibration_scores Brier loop
 * (Scope B, May 10) to feed evolution back into the belief table.
 *
 * Algorithm — daily:
 *   1. For each (call_sign, domain) row in agent_calibration_scores
 *      with total_predictions ≥ MIN_N:
 *        a. If brier_score is high (≥0.30), the agent is poorly
 *           calibrated in that domain. Decay confidence on the
 *           agent's beliefs whose related_domains overlap the
 *           calibration domain.
 *        b. If brier_score is low (≤0.15), the agent is sharp in that
 *           domain — bump confidence on those beliefs.
 *   2. Append an evolution_log entry recording what changed and why,
 *      so the trail is auditable.
 *
 * Decay/bump magnitude is small (±0.05 per run, capped) so a single
 * bad week doesn't collapse a belief base. Convergence is gradual,
 * matching the calibration table's own 90-day rolling rebuild.
 *
 * Domain matching: agent_calibration_scores.domain is the signal
 * category (e.g. "protest", "natural_disaster"). agent_beliefs
 * .related_domains is derived from agent specialty text. We match
 * loosely — if either contains the other as a substring (case-insensitive
 * after splitting on whitespace), they're related. Imperfect but better
 * than no signal-→-belief grounding at all.
 *
 * Safety:
 *   - Confidence floors at MIN_BELIEF_CONFIDENCE (0.20) so beliefs
 *     never get fully zeroed out.
 *   - Confidence ceilings at MAX_BELIEF_CONFIDENCE (0.95) so a
 *     well-calibrated agent doesn't claim certainty it can't justify.
 *   - Caps adjustments per belief at ±0.05 per run.
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const JOB_NAME = "decay-beliefs-from-calibration-daily";
const MIN_N = 10;                  // need ≥10 predictions before we trust the Brier
const HIGH_BRIER = 0.30;           // above this → decay
const LOW_BRIER = 0.15;            // below this → bump
const STEP = 0.05;                 // per-run adjustment
const MIN_BELIEF_CONFIDENCE = 0.20;
const MAX_BELIEF_CONFIDENCE = 0.95;

interface CalibRow {
  call_sign: string;
  domain: string;
  brier_score: number;
  total_predictions: number;
}

interface BeliefRow {
  id: string;
  agent_call_sign: string;
  hypothesis: string;
  confidence: number;
  related_domains: string[] | null;
  evolution_log: any;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB_NAME);

  try {
    // 1. Pull calibration rows with enough sample size to act on.
    const { data: calibRaw, error: calibErr } = await supabase
      .from("agent_calibration_scores")
      .select("call_sign, domain, brier_score, total_predictions")
      .gte("total_predictions", MIN_N);
    if (calibErr) throw new Error(`calibration fetch: ${calibErr.message}`);
    const calibrations: CalibRow[] = (calibRaw ?? []).map((r: any) => ({
      call_sign: r.call_sign,
      domain: String(r.domain ?? "").toLowerCase(),
      brier_score: Number(r.brier_score) || 0,
      total_predictions: Number(r.total_predictions) || 0,
    }));

    if (calibrations.length === 0) {
      const summary = { calibration_rows: 0, beliefs_decayed: 0, beliefs_bumped: 0, agents_touched: 0 };
      await completeHeartbeat(supabase, hb, summary);
      return successResponse({ success: true, ...summary });
    }

    // 2. For each agent that has any calibration row, pull their beliefs.
    const agentSet = Array.from(new Set(calibrations.map((c) => c.call_sign)));
    const { data: beliefsRaw, error: bErr } = await supabase
      .from("agent_beliefs")
      .select("id, agent_call_sign, hypothesis, confidence, related_domains, evolution_log")
      .in("agent_call_sign", agentSet)
      .eq("is_active", true);
    if (bErr) throw new Error(`belief fetch: ${bErr.message}`);
    const beliefs: BeliefRow[] = beliefsRaw ?? [];

    // 3. For each belief, find calibration rows that touch its domains
    // (loose substring match). Compute net adjustment from all
    // matching rows, capped at ±STEP.
    let beliefsDecayed = 0;
    let beliefsBumped = 0;
    const agentsTouched = new Set<string>();
    const updates: Array<{ id: string; new_conf: number; log_entry: any }> = [];

    for (const belief of beliefs) {
      const domains = (belief.related_domains ?? []).map((d) => String(d).toLowerCase());
      if (domains.length === 0) continue;

      const matches = calibrations.filter(
        (c) =>
          c.call_sign === belief.agent_call_sign &&
          domains.some((d) => d.includes(c.domain) || c.domain.includes(d)),
      );
      if (matches.length === 0) continue;

      // Aggregate signal — average Brier across the matching domains
      // weighted by total_predictions. Use that one number to decide
      // direction.
      const totalN = matches.reduce((s, m) => s + m.total_predictions, 0);
      const weightedBrier =
        matches.reduce((s, m) => s + m.brier_score * m.total_predictions, 0) / totalN;

      let delta = 0;
      let direction: "decay" | "bump" | null = null;
      if (weightedBrier >= HIGH_BRIER) {
        delta = -STEP;
        direction = "decay";
      } else if (weightedBrier <= LOW_BRIER) {
        delta = +STEP;
        direction = "bump";
      } else {
        continue; // mid-band → no change
      }

      const next = clamp(belief.confidence + delta, MIN_BELIEF_CONFIDENCE, MAX_BELIEF_CONFIDENCE);
      if (Math.abs(next - belief.confidence) < 0.001) continue;

      const logEntry = {
        ts: new Date().toISOString(),
        source: "calibration_decay",
        prev_confidence: belief.confidence,
        new_confidence: next,
        weighted_brier: round3(weightedBrier),
        domains_matched: matches.map((m) => m.domain),
        sample_size: totalN,
        reason: direction === "decay"
          ? `Brier ${round3(weightedBrier)} above ${HIGH_BRIER} in ${matches.length} domain(s) — agent miscalibrated, decaying confidence`
          : `Brier ${round3(weightedBrier)} below ${LOW_BRIER} in ${matches.length} domain(s) — agent well-calibrated, bumping confidence`,
      };
      const newLog = Array.isArray(belief.evolution_log) ? [...belief.evolution_log, logEntry] : [logEntry];

      updates.push({ id: belief.id, new_conf: next, log_entry: newLog });
      if (direction === "decay") beliefsDecayed++; else beliefsBumped++;
      agentsTouched.add(belief.agent_call_sign);
    }

    // 4. Apply updates one by one (would batch but we want individual
    // evolution_log entries — JSONB concat isn't reliable in upsert).
    for (const u of updates) {
      const { error } = await supabase
        .from("agent_beliefs")
        .update({
          confidence: u.new_conf,
          evolution_log: u.log_entry,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", u.id);
      if (error) {
        console.warn(`[${JOB_NAME}] update ${u.id} failed:`, error.message);
      }
    }

    const summary = {
      calibration_rows: calibrations.length,
      beliefs_examined: beliefs.length,
      beliefs_decayed: beliefsDecayed,
      beliefs_bumped: beliefsBumped,
      agents_touched: agentsTouched.size,
    };
    await completeHeartbeat(supabase, hb, summary);
    console.log(`[${JOB_NAME}] ${JSON.stringify(summary)}`);
    return successResponse({ success: true, ...summary });
  } catch (e: any) {
    console.error(`[${JOB_NAME}] Fatal:`, e);
    await failHeartbeat(supabase, hb, e instanceof Error ? e : new Error(String(e)));
    return errorResponse(e?.message ?? "decay-beliefs failed", 500);
  }
});

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
