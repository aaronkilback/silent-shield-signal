// =============================================================================
// Shared actor-time grounding primitive (G-9)
// =============================================================================
//
// Single source of truth for "does this signal carry a defensible ACTOR-TIME
// timestamp?" — i.e. a timestamp that reflects when the underlying actor posted
// / the event occurred, NOT when Fortress ingested the signal.
//
// WHY THIS EXISTS (G-9 audit, docs/platform-operations/g9-axis-interpretability-
// audit-2026-06-01.md): `signals.created_at` is by schema definition a write
// timestamp (DEFAULT now(), set by Postgres on INSERT). It reflects monitor
// collection cadence, never actor behavior. Any axis that buckets actors by
// `created_at` measures the monitor's cron schedule, producing structural
// false positives between any two entities monitored by the same job.
//
// The ONLY field that can carry actor-time is `event_date`, and only when the
// writer populated it from a real upstream timestamp. This module decides,
// per-signal and structurally (no monitor allowlist), whether that is the case.
//
// DESIGN NOTES
//   • Per-signal, monitor-agnostic. We deliberately do NOT gate on a hardcoded
//     Tier-A monitor allowlist: that is coarser than the defect (even Tier-A
//     monitors like NAAD emit ~32% cosmetic/NULL event_date) and silently
//     excludes monitors onboarded after the audit. The structural test below
//     is strictly more correct on both axes. See the G-9 answer in the session
//     record for the full justification.
//   • NO latency upper bound. Downstream axes bucket on `event_date` itself, so
//     a large collection latency does NOT corrupt the bucket placement — the
//     bucket lands at the real event hour regardless. Excluding legitimately
//     late-collected real events on a latency bound would only lose precision.
//     The defect we must reject is FABRICATED event_date (cosmetic-midnight or
//     copied-from-created), not honest-but-late event_date.
//   • Pure functions only. No Date.now(), no I/O. Same inputs → same outputs.
//
// RELATIONSHIP TO aegis-coverage-confidence.ts::isTemporallyGrounded
//   That function answers a related-but-different question (is the signal
//   grounded for *recency/coverage* scoring) and intentionally uses a looser
//   test (it does not reject copied-from-created). It is a shipped Workstream D
//   capability; aligning it to this stricter primitive is a tracked follow-up,
//   NOT bundled into the G-9 change, to avoid silently shifting its gate.

// ─────────────────────────────────────────────────────────────────────────────
// §A — Operator-tunable thresholds (changes require PR + sign-off)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * event_date within this many ms of UTC-midnight-of-its-own-day, AND on the
 * same calendar day as created_at, is treated as a cosmetic write-time artifact
 * (the writer stamped "midnight of the day it ingested") rather than a real
 * event time. Mirrors the coverage-confidence cosmetic-midnight tolerance.
 */
export const COSMETIC_MIDNIGHT_MS_TOLERANCE = 1000; // < 1s deviation = cosmetic

/**
 * event_date within this many ms of created_at is treated as copied-from-created
 * (the writer set `event_date := created_at` because no real upstream timestamp
 * was available) and therefore carries no independent actor-time information.
 *
 * 5s cleanly separates copied timestamps (sub-second to seconds) from genuine
 * collection latency, which the G-9 audit measured at 9-61 min even for the
 * fastest real-time RSS monitors (Tier A). No real monitor collects within 5s.
 */
export const COPIED_FROM_CREATED_MS_TOLERANCE = 5000; // ≤5s = copied write-time

// ─────────────────────────────────────────────────────────────────────────────
// §B — Types
// ─────────────────────────────────────────────────────────────────────────────

/** The T-0/T-3 temporal_grounding column domain (column is 100% 'unknown' in prod today). */
export type TemporalGroundingValue =
  | "unknown"
  | "current_grounded"
  | "historical_grounded"
  | "current_inferred"
  | "historical_inferred";

/** Minimal signal shape needed to decide actor-time grounding. */
export interface TemporalSignal {
  /** ISO ingestion timestamp (signals.created_at — DEFAULT now(); write-time). */
  created_at: string;
  /** ISO actor/event timestamp when the writer populated it (signals.event_date). */
  event_date: string | null;
  /** Explicit grounding column when populated; undefined/null falls back to structural. */
  temporal_grounding?: TemporalGroundingValue | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — Structural detectors (exported for reuse + direct testing)
// ─────────────────────────────────────────────────────────────────────────────

/** True when event_date is cosmetic-midnight-of-created_at's day (a write artifact). */
export function isCosmeticMidnight(eventMs: number, createdMs: number): boolean {
  const eventDate = new Date(eventMs);
  const createdDate = new Date(createdMs);
  const sameDay =
    eventDate.getUTCFullYear() === createdDate.getUTCFullYear() &&
    eventDate.getUTCMonth() === createdDate.getUTCMonth() &&
    eventDate.getUTCDate() === createdDate.getUTCDate();
  if (!sameDay) return false;
  const startOfDay = Date.UTC(
    eventDate.getUTCFullYear(),
    eventDate.getUTCMonth(),
    eventDate.getUTCDate(),
  );
  return Math.abs(eventMs - startOfDay) < COSMETIC_MIDNIGHT_MS_TOLERANCE;
}

/** True when event_date is effectively equal to created_at (copied write-time). */
export function isCopiedFromCreated(eventMs: number, createdMs: number): boolean {
  return Math.abs(eventMs - createdMs) <= COPIED_FROM_CREATED_MS_TOLERANCE;
}

// ─────────────────────────────────────────────────────────────────────────────
// §D — Canonical grounding hierarchy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The grounded-timestamp hierarchy, in resolution order:
 *
 *   1. Explicit column: temporal_grounding ∈ {current_grounded, historical_grounded}
 *      → grounded (authoritative; becomes the primary path when the T-1 writer ships).
 *   2. Explicit INFERRED (current_inferred / historical_inferred) → NOT grounded
 *      (a real determination that the time was inferred, not directly grounded).
 *   3. 'unknown' (the schema default — 100% of prod today, i.e. "no determination
 *      made") OR column null/unset → structural fallback on event_date:
 *        - event_date NULL or unparseable → NOT grounded
 *        - cosmetic-midnight-of-created → NOT grounded (write artifact)
 *        - copied-from-created → NOT grounded (no independent actor-time)
 *        - otherwise → grounded
 *
 * `created_at` is NEVER an actor-time source under any branch.
 */
export function isActorTimeGrounded(s: TemporalSignal): boolean {
  // Branch 1/2 — explicit column (authoritative when populated)
  if (s.temporal_grounding === "current_grounded") return true;
  if (s.temporal_grounding === "historical_grounded") return true;
  if (
    s.temporal_grounding === "current_inferred" ||
    s.temporal_grounding === "historical_inferred"
  ) {
    // Explicit determination that the time was inferred, not directly grounded.
    return false;
  }
  // 'unknown' (schema default = no determination; 100% of prod today) OR column
  // null/unset → fall through to the structural check below. Treating 'unknown'
  // as hard-false makes the structural fallback dead code in prod (the bug fixed
  // here): prod is 100% the string 'unknown', so nothing would ever ground.

  // Branch 3 — structural fallback (today's prod path)
  if (!s.event_date) return false;
  const eventMs = Date.parse(s.event_date);
  const createdMs = Date.parse(s.created_at);
  if (!Number.isFinite(eventMs) || !Number.isFinite(createdMs)) return false;
  if (isCosmeticMidnight(eventMs, createdMs)) return false;
  if (isCopiedFromCreated(eventMs, createdMs)) return false;
  return true;
}

/**
 * Returns the trustworthy actor-time ISO string for a signal, or null when the
 * signal is not actor-time-grounded. The returned value is always `event_date`
 * (never `created_at`) — callers must bucket / compute on this, never on
 * `created_at`.
 */
export function groundedActorTime(s: TemporalSignal): string | null {
  return isActorTimeGrounded(s) ? s.event_date : null;
}
