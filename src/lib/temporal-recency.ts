// Temporal recency — frontend mirror of supabase/functions/_shared/temporal-recency.ts.
// Keeps CRT-facing UI (signal feed, dashboards) in lockstep with Aegis/COP/briefings:
// recency keys on surface_date (became-news) → grounded event_date → NULL (unknown).
// created_at (ingestion) is NEVER treated as event/news time. Cosmetic-midnight /
// copied-from-created event_dates are rejected (mirror of the G-9 grounding primitive).

export type TemporalBucket = "current" | "timing_unknown" | "historical";

export const TEMPORAL_LABELS: Record<TemporalBucket, string> = {
  current: "Current",
  timing_unknown: "Timing Unknown",
  historical: "Historical / Resurfaced",
};

export const TEMPORAL_BADGE_VARIANT: Record<TemporalBucket, "default" | "secondary" | "outline"> = {
  current: "default",
  timing_unknown: "outline",
  historical: "secondary",
};

export interface RecencySignal {
  created_at: string;
  event_date?: string | null;
  surface_date?: string | null;
  temporal_grounding?: string | null;
}

const COSMETIC_MIDNIGHT_MS = 1000;
const COPIED_MS = 5000;

/** Mirror of isActorTimeGrounded: event_date is trustworthy actor/event time. */
function isGroundedEventDate(s: RecencySignal): boolean {
  if (s.temporal_grounding === "current_grounded" || s.temporal_grounding === "historical_grounded") return true;
  if (s.temporal_grounding === "current_inferred" || s.temporal_grounding === "historical_inferred") return false;
  // 'unknown' / unset → structural check
  if (!s.event_date) return false;
  const ev = Date.parse(s.event_date), cr = Date.parse(s.created_at);
  if (!Number.isFinite(ev) || !Number.isFinite(cr)) return false;
  if (Math.abs(cr - ev) <= COPIED_MS) return false; // copied-from-created
  const evd = new Date(ev), crd = new Date(cr);
  const sameDay = evd.getUTCFullYear() === crd.getUTCFullYear() && evd.getUTCMonth() === crd.getUTCMonth() && evd.getUTCDate() === crd.getUTCDate();
  if (sameDay) {
    const midnight = Date.UTC(evd.getUTCFullYear(), evd.getUTCMonth(), evd.getUTCDate());
    if (Math.abs(ev - midnight) < COSMETIC_MIDNIGHT_MS) return false; // cosmetic-midnight
  }
  return true;
}

export function effectiveRecencyDate(s: RecencySignal): string | null {
  if (s.surface_date) return s.surface_date;
  if (s.event_date && isGroundedEventDate(s)) return s.event_date;
  return null;
}

export function classifyTemporalBucket(s: RecencySignal, windowDays = 7, now: Date = new Date()): TemporalBucket {
  const eff = effectiveRecencyDate(s);
  if (eff === null) return "timing_unknown";
  const t = Date.parse(eff), nowMs = now.getTime();
  if (!Number.isFinite(t) || t > nowMs + 24 * 3600 * 1000) return "timing_unknown";
  return t >= nowMs - windowDays * 24 * 3600 * 1000 ? "current" : "historical";
}

/**
 * True when the signal's grounded effective date is in the FUTURE (scheduled /
 * upcoming). Not "current" (hasn't occurred) but the date IS known — caption it
 * honestly rather than as "timing unknown". Sits inside the timing_unknown bucket.
 */
export function isUpcoming(s: RecencySignal, now: Date = new Date()): boolean {
  const eff = effectiveRecencyDate(s);
  if (!eff) return false;
  const t = Date.parse(eff);
  return Number.isFinite(t) && t > now.getTime() + 24 * 3600 * 1000;
}

/** Operator-facing one-liner so the UI never implies an old/undated/future item is current. */
export function temporalCaption(s: RecencySignal): string {
  const b = classifyTemporalBucket(s);
  if (b === "current") return `Current (event ${effectiveRecencyDate(s)?.slice(0, 10)})`;
  if (b === "historical") return `Historical / Resurfaced — event ${effectiveRecencyDate(s)?.slice(0, 10)}; ingested ${s.created_at.slice(0, 10)}`;
  if (isUpcoming(s)) return `Upcoming / scheduled — event ${effectiveRecencyDate(s)?.slice(0, 10)} (not yet occurred); ingested ${s.created_at.slice(0, 10)}`;
  return `Timing unknown — ingested ${s.created_at.slice(0, 10)} (event date not established)`;
}
