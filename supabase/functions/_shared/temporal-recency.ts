// =============================================================================
// Temporal recency — single source of truth for "is this current?"
// =============================================================================
// Fixes the temporal-integrity defect: recency must key on WHEN-IT-HAPPENED /
// WHEN-IT-BECAME-NEWS, never on created_at (ingestion). Every surface (COP,
// briefings, agent-intelligence, handlers, Aegis, and the frontend mirror in
// src/lib/temporal-recency.ts) must classify identically via this module.
//
// Precedence: surface_date (became-news) → grounded event_date (when it
// happened) → NULL = timing unknown. created_at is NEVER an event/news time.
// Cosmetic/copied event_dates are rejected via the G-9 grounding primitive.

import { isActorTimeGrounded, type TemporalSignal } from "./temporal-grounding.ts";

export type TemporalBucket = "current" | "timing_unknown" | "historical";

export interface RecencySignal extends TemporalSignal {
  /** Publication / "became news" time (signals.surface_date). */
  surface_date?: string | null;
}

export const TEMPORAL_LABELS: Record<TemporalBucket, string> = {
  current: "Current",
  timing_unknown: "Timing Unknown",
  historical: "Historical / Resurfaced",
};

/**
 * The trustworthy recency date: surface_date (became-news) first, else the
 * GROUNDED event_date (cosmetic/copied → rejected). Returns null when timing is
 * unknown. Callers MUST NOT substitute created_at for a null result.
 */
export function effectiveRecencyDate(s: RecencySignal): string | null {
  if (s.surface_date) return s.surface_date;
  if (s.event_date && isActorTimeGrounded(s)) return s.event_date;
  return null;
}

/**
 * Classify a signal into Current / Timing-Unknown / Historical for a recency
 * window. `nowMs` is passed in for determinism/testability.
 */
export function classifyTemporalBucket(
  s: RecencySignal,
  windowDays: number,
  nowMs: number,
): TemporalBucket {
  const eff = effectiveRecencyDate(s);
  if (eff === null) return "timing_unknown";
  const t = Date.parse(eff);
  if (!Number.isFinite(t) || t > nowMs + 24 * 3600 * 1000) return "timing_unknown"; // unparseable/future → unknown
  return t >= nowMs - windowDays * 24 * 3600 * 1000 ? "current" : "historical";
}

/** Partition a candidate set (e.g. recently-ingested rows) into the three buckets. */
export function partitionByRecency<T extends RecencySignal>(
  rows: readonly T[],
  windowDays: number,
  nowMs: number,
): { current: T[]; timing_unknown: T[]; historical: T[] } {
  const out = { current: [] as T[], timing_unknown: [] as T[], historical: [] as T[] };
  for (const r of rows) out[classifyTemporalBucket(r, windowDays, nowMs)].push(r);
  return out;
}
