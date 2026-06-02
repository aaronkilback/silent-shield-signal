// =============================================================================
// ER v1 Slice 2 — Posting-Time Fingerprint axis
// =============================================================================
//
// Measures whether two actors share a posting-time fingerprint by:
//   1. Filtering each actor's signals to those with a defensible ACTOR-TIME
//      timestamp (G-9: `isActorTimeGrounded`). Signals whose only timestamp is
//      collection-cadence (`created_at`) or a write-artifact `event_date`
//      (cosmetic-midnight / copied-from-created) are excluded — they would
//      otherwise inject the monitor's cron schedule into the histogram.
//   2. Bucketing the GROUNDED signals' `event_date` (never `created_at`) into a
//      168-cell vector (hour-of-week, UTC, 0 = Monday 00:00).
//   3. Computing Pearson correlation over the two vectors.
//   4. Identifying the hours where both actors were heavily active.
//
// G-9 (docs/platform-operations/g9-axis-interpretability-audit-2026-06-01.md):
// reading `created_at` made this axis measure monitor collection cadence, not
// actor activity — a structural false positive between any two entities scraped
// by the same job. The sample floor now applies to the GROUNDED count, so an
// actor whose signals are all cadence-only cannot reach it and the axis stubs.
//
// Determinism: no randomness; signals must be passed in deterministic order;
// vector indexes are pure arithmetic. Same inputs → same outputs every run.
//
// Operator-tunable thresholds are exported as named constants. Changes require
// a PR + operator sign-off per Workstream D convention. Inline tuning is banned.

import type { PostingTimeEvidence } from "./_evidence-schema.ts";
import {
  groundedActorTime,
  type TemporalSignal,
} from "../temporal-grounding.ts";

// ─────────────────────────────────────────────────────────────────────────────
// §A — Operator-tunable thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum signals per actor required to make this axis meaningful.
 * Below this, the axis emits `status="insufficient_samples"` and contributes
 * nothing to confidence (per operator's UNKNOWN-first rule).
 */
export const POSTING_TIME_MIN_SIGNALS_PER_ACTOR = 10;

/** Pearson r ≥ this → axis exceeds the "moderate" overlap threshold. */
export const POSTING_TIME_MODERATE_PEARSON = 0.5;

/** Pearson r ≥ this → axis exceeds the "strong" overlap threshold. */
export const POSTING_TIME_STRONG_PEARSON = 0.7;

/**
 * Pearson r ≥ this → this axis emits "high-confidence evidence" — a strong
 * promotion signal toward HIGH cluster confidence per the predicate aggregator.
 */
export const POSTING_TIME_HIGH_CONFIDENCE_FLOOR = 0.7;

/**
 * How many shared "top hours" to report in the evidence summary. Reviewable
 * by the operator without overwhelming the output.
 */
export const POSTING_TIME_TOP_SHARED_HOURS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// §B — Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Bucket a UTC timestamp into 0-167 (Monday 00:00 = 0). */
export function hourOfWeekUTC(d: Date): number {
  // JS getDay(): Sun=0..Sat=6. Re-index to Mon=0..Sun=6.
  const day = (d.getUTCDay() + 6) % 7;
  const hour = d.getUTCHours();
  return day * 24 + hour;
}

/** Deterministic Pearson over two equal-length numeric vectors. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length === 0) return null;
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null; // either vector is constant → undefined correlation
  return num / denom;
}

/** Day names for human-readable summaries. */
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Format a single hour-of-week integer (0-167) as "Mon 14:00" etc. */
export function formatHourOfWeek(hw: number): string {
  const d = Math.floor(hw / 24);
  const h = hw % 24;
  return `${DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00`;
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — Main axis function
// ─────────────────────────────────────────────────────────────────────────────

export interface PostingTimeInput {
  /**
   * Signal records for entity A. Each must carry `created_at` + `event_date`
   * (+ optional `temporal_grounding`). The axis itself decides which are
   * actor-time-grounded and buckets ONLY those, on `event_date`.
   */
  signalsA: readonly TemporalSignal[];
  /** Signal records for entity B (see above). */
  signalsB: readonly TemporalSignal[];
}

/**
 * Compute the Posting-Time Fingerprint axis.
 *
 * Returns `PostingTimeEvidence` with status="computed" when BOTH actors have
 * ≥ `POSTING_TIME_MIN_SIGNALS_PER_ACTOR` actor-time-GROUNDED signals, else
 * status="insufficient_samples". The grounded filter (`groundedActorTime`) is
 * what prevents collection-cadence timestamps from driving the histogram.
 *
 * Never throws on valid input. Never calls external APIs. Pure math.
 */
export function computePostingTimeAxis(
  input: PostingTimeInput,
): PostingTimeEvidence {
  const n_signals_a = input.signalsA.length;
  const n_signals_b = input.signalsB.length;

  // G-9: keep only signals with defensible actor-time; bucket on event_date.
  const groundedA = input.signalsA
    .map(groundedActorTime)
    .filter((t): t is string => t !== null);
  const groundedB = input.signalsB
    .map(groundedActorTime)
    .filter((t): t is string => t !== null);
  const grounded_signal_count_a = groundedA.length;
  const grounded_signal_count_b = groundedB.length;

  if (
    grounded_signal_count_a < POSTING_TIME_MIN_SIGNALS_PER_ACTOR ||
    grounded_signal_count_b < POSTING_TIME_MIN_SIGNALS_PER_ACTOR
  ) {
    return {
      status: "insufficient_samples",
      stub_reason:
        `posting-time axis needs ≥${POSTING_TIME_MIN_SIGNALS_PER_ACTOR} actor-time-grounded ` +
        `signals per actor (event_date that is not collection-cadence); ` +
        `entity A: ${grounded_signal_count_a} grounded of ${n_signals_a} retrieved, ` +
        `entity B: ${grounded_signal_count_b} grounded of ${n_signals_b} retrieved`,
      n_signals_a,
      n_signals_b,
      grounded_signal_count_a,
      grounded_signal_count_b,
      pearson_r: null,
      most_active_shared_hours: [],
      evidence_summary: "",
      exceeds_moderate: false,
      exceeds_strong: false,
      has_high_confidence_evidence: false,
    };
  }

  // Build 168-cell hour-of-week vectors from GROUNDED actor-time (event_date).
  const vecA = new Array<number>(168).fill(0);
  const vecB = new Array<number>(168).fill(0);
  for (const ts of groundedA) vecA[hourOfWeekUTC(new Date(ts))]++;
  for (const ts of groundedB) vecB[hourOfWeekUTC(new Date(ts))]++;

  const r = pearson(vecA, vecB);

  // Identify shared "top hours" — hours where both actors are above their median
  // (deterministic tiebreak by lower hour index).
  const totalA = vecA.reduce((a, b) => a + b, 0);
  const totalB = vecB.reduce((a, b) => a + b, 0);
  const sharedHours: { hour_of_week: number; a_share: number; b_share: number }[] = [];
  for (let i = 0; i < 168; i++) {
    if (vecA[i] === 0 || vecB[i] === 0) continue;
    sharedHours.push({
      hour_of_week: i,
      a_share: totalA > 0 ? vecA[i] / totalA : 0,
      b_share: totalB > 0 ? vecB[i] / totalB : 0,
    });
  }
  sharedHours.sort((a, b) => {
    // Higher combined share first; tiebreak by lower hour index for determinism.
    const aw = a.a_share + a.b_share;
    const bw = b.a_share + b.b_share;
    if (bw !== aw) return bw - aw;
    return a.hour_of_week - b.hour_of_week;
  });
  const topShared = sharedHours.slice(0, POSTING_TIME_TOP_SHARED_HOURS);

  const exceeds_moderate = r !== null && r >= POSTING_TIME_MODERATE_PEARSON;
  const exceeds_strong   = r !== null && r >= POSTING_TIME_STRONG_PEARSON;
  const has_high_confidence_evidence = r !== null && r >= POSTING_TIME_HIGH_CONFIDENCE_FLOOR;

  // Human-readable summary — the operator must be able to read this aloud.
  const rText = r === null ? "undefined (zero-variance vector)" : r.toFixed(2);
  const topHoursText = topShared.length === 0
    ? "no shared active hours"
    : topShared.slice(0, 3).map(s => formatHourOfWeek(s.hour_of_week)).join(", ");
  const evidence_summary =
    `pearson_r=${rText} over ${grounded_signal_count_a}/${grounded_signal_count_b} ` +
    `actor-time-grounded signals (of ${n_signals_a}/${n_signals_b} retrieved); ` +
    `top shared active hours: ${topHoursText}`;

  return {
    status: "computed",
    stub_reason: null,
    n_signals_a,
    n_signals_b,
    grounded_signal_count_a,
    grounded_signal_count_b,
    pearson_r: r,
    most_active_shared_hours: topShared,
    evidence_summary,
    exceeds_moderate,
    exceeds_strong,
    has_high_confidence_evidence,
  };
}
