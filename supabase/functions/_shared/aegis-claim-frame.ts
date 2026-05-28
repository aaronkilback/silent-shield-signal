// supabase/functions/_shared/aegis-claim-frame.ts
//
// Workstream D — slim slice — Amendment A1 four-question framing.
// ADR §A1: outputs must answer
//   1. What do we know?         (claim payload + type label)
//   2. How do we know it?       (sources + corroboration count + provenance label)
//   3. How confident are we?    (qualitative summary backed by drillable axes)
//   4. What action, if any?     (recommendation-only; never executed)
//
// The frame is the OPERATOR-FACING surface. The §3 axes are the substrate.
// Display layers (B + C + any Aegis prose) consume `frameClaim` rather than
// reading axes directly so the four-question discipline is structurally enforced.

import {
  ClaimType,
  ConfidenceAxes,
  ConfidenceSummary,
  SourceRecord,
  dedupeProvenanceLineages,
  summarizeConfidence,
} from "./aegis-confidence.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Action-consideration shape (§A1.3) — execution invariants enforced at type level.
// ─────────────────────────────────────────────────────────────────────────────
export interface ActionConsideration {
  /** Enumerated registry key, or null when no action is recommended. */
  recommended_action: string | null;
  /** One short sentence; required iff recommended_action !== null. */
  rationale: string | null;
  /**
   * BINDING invariant — operator approval is always required in this phase.
   * Literal `true` so a future code change cannot quietly remove it.
   */
  requires_operator_approval: true;
  approval_state: "not_yet_reviewed" | "queued" | "approved" | "rejected";
  /**
   * BINDING invariant — execution is intentionally delayed in this phase.
   * Literal `false` so a future code change cannot quietly set it true without
   * an explicit type-system override (caught by CI).
   */
  executed: false;
}

export function noActionConsideration(): ActionConsideration {
  return {
    recommended_action: null,
    rationale: null,
    requires_operator_approval: true,
    approval_state: "not_yet_reviewed",
    executed: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Claim frame
// ─────────────────────────────────────────────────────────────────────────────
export interface ClaimWhat {
  /** Plain-language statement. No jargon, no axis numbers. */
  label: string;
  /** The structured claim payload (drillable). */
  payload: unknown;
  /** §2 type label — mandatory; never optional on display. */
  type: ClaimType;
}

export interface ClaimHow {
  source_count: number;        // raw count of source records
  lineage_count: number;       // §3.1 distinct provenance lineages
  provenance_label: string;    // plain-language label (e.g. "audited monitor", "tenant document")
  sources: SourceRecord[];     // drillable
}

export interface ClaimConfidence {
  summary: ConfidenceSummary;  // §A1.1 — the headline label
  axes: ConfidenceAxes;        // drillable substrate
  freshness_label: string;     // plain-language ("fresh" / "stale, 47 days")
}

export interface ClaimFrame {
  what: ClaimWhat;
  how: ClaimHow;
  confidence: ClaimConfidence;
  consideration: ActionConsideration;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain-language helpers (operator-readable; never reveal axis numbers in headline).
// ─────────────────────────────────────────────────────────────────────────────
const PROVENANCE_LABEL: Record<string, string> = {
  analyst_confirmed:         "operator-validated",
  audited_monitor_allowlist: "audited monitor",
  tenant_document:           "tenant document",
  poi_investigation:         "person-of-interest investigation",
  case_investigation:        "case investigation",
  audited_monitor_openweb:   "open-web monitor",
  quarantined:               "quarantined source",
  ai_only:                   "model inference",
};

function bestProvenanceLabel(sources: SourceRecord[]): string {
  // Use the highest-weight source's label as the headline. Mirrors §3.2 "max" rule.
  if (sources.length === 0) return "no source";
  // Sort by surface ranking (mirrors PROVENANCE_WEIGHTS ordering).
  const ranked = [...sources].sort((a, b) => {
    const order = [
      "analyst_confirmed",
      "audited_monitor_allowlist",
      "tenant_document",
      "poi_investigation",
      "case_investigation",
      "audited_monitor_openweb",
      "quarantined",
      "ai_only",
    ];
    return order.indexOf(a.surface) - order.indexOf(b.surface);
  });
  return PROVENANCE_LABEL[ranked[0].surface] ?? ranked[0].surface;
}

function freshnessLabel(axes: ConfidenceAxes, sources: SourceRecord[]): string {
  if (sources.length === 0) return "no observed evidence";
  // Most-recent age in days, computed from the same source set.
  const now = Date.now();
  let mostRecent = -Infinity;
  for (const s of sources) {
    const t = new Date(s.observed_at).getTime();
    if (Number.isFinite(t) && t > mostRecent) mostRecent = t;
  }
  if (!Number.isFinite(mostRecent)) return "evidence timestamp missing";
  const ageDays = Math.floor((now - mostRecent) / (24 * 3600 * 1000));
  if (axes.freshness >= 0.7) return `fresh (most recent ${ageDays}d ago)`;
  if (axes.freshness >= 0.4) return `aging (most recent ${ageDays}d ago)`;
  return `stale (most recent ${ageDays}d ago)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// frameClaim — assemble the four-question structure for display.
// ─────────────────────────────────────────────────────────────────────────────
export interface FrameClaimInput {
  claim_type: ClaimType;
  label: string;
  payload: unknown;
  sources: SourceRecord[];
  axes: ConfidenceAxes;
  consideration?: ActionConsideration;
}

export function frameClaim(input: FrameClaimInput): ClaimFrame {
  const lineages = dedupeProvenanceLineages(input.sources);
  return {
    what: {
      label: input.label,
      payload: input.payload,
      type: input.claim_type,
    },
    how: {
      source_count: input.sources.length,
      lineage_count: lineages.length,
      provenance_label: bestProvenanceLabel(input.sources),
      sources: input.sources,
    },
    confidence: {
      summary: summarizeConfidence(input.claim_type, input.axes),
      axes: input.axes,
      freshness_label: freshnessLabel(input.axes, input.sources),
    },
    consideration: input.consideration ?? noActionConsideration(),
  };
}
