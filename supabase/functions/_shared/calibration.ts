/**
 * Calibration-aware confidence attenuation.
 *
 * Background — many specialist write paths emit a stated confidence
 * (some hardcoded, some agent-emitted) and persist it directly into
 * signal_agent_analyses.confidence_score. The score-agent-calibration
 * job grades those numbers against actual outcomes (resolved /
 * false_positive) and produces a Brier score per (call_sign, domain).
 *
 * This helper closes the loop: when an agent is about to persist a
 * confidence, it looks up the agent's calibration history for that
 * domain and pulls overconfident-but-wrong agents toward 0.5
 * (max-uncertainty) before the write. Well-calibrated agents pass
 * through nearly unchanged. Agents with no history pass through
 * unchanged (the calibration is null until ≥20 predictions land).
 *
 * Formula:
 *   attenuated = stated * (1 - brier) clamped to [0.5 * stated, stated]
 *
 * Brier is bounded [0, 1]:
 *   - brier ≈ 0    → multiplier ≈ 1.0   (no attenuation)
 *   - brier ≈ 0.25 → multiplier ≈ 0.75
 *   - brier ≈ 0.5  → multiplier ≈ 0.5   (clamps at floor)
 *   - brier > 0.5  → still clamped at 0.5 floor
 *
 * The 0.5-floor prevents a single bad week from collapsing an agent's
 * confidence to zero; calibration recovers as the rolling 90-day
 * window forgets old miscalibrations.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const BRIER_FLOOR_RATIO = 0.5; // never attenuate below half the stated confidence

interface AttenuationResult {
  /** The confidence to actually persist. */
  attenuated: number;
  /** The agent's Brier score for the domain, or null if no history. */
  brier: number | null;
  /** Number of resolved-signal predictions backing the Brier score. */
  n: number;
}

export async function attenuateConfidence(
  supabase: SupabaseClient,
  callSign: string,
  domain: string,
  statedConfidence: number,
): Promise<AttenuationResult> {
  if (!Number.isFinite(statedConfidence) || statedConfidence <= 0) {
    return { attenuated: 0, brier: null, n: 0 };
  }
  if (!callSign || !domain) {
    return { attenuated: statedConfidence, brier: null, n: 0 };
  }

  const { data, error } = await supabase
    .from("agent_calibration_scores")
    .select("brier_score, total_predictions")
    .eq("call_sign", callSign)
    .eq("domain", domain)
    .maybeSingle();

  if (error || !data || (data.total_predictions ?? 0) <= 0) {
    return { attenuated: statedConfidence, brier: null, n: 0 };
  }

  const brier = Number(data.brier_score) || 0;
  const n = Number(data.total_predictions) || 0;
  const multiplier = Math.max(BRIER_FLOOR_RATIO, 1 - brier);
  const attenuated = round3(statedConfidence * multiplier);

  return { attenuated, brier, n };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
