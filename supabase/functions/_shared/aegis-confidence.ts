// supabase/functions/_shared/aegis-confidence.ts
//
// Workstream D — pure-function evaluators for confidence + provenance.
// ADR: docs/platform-operations/architecture-decisions/workstream-d-confidence-and-provenance-layers.md
//
// HARD RULES (binding, mirror the ADR):
//   • Six axes are NEVER collapsed for display; an internal composite exists for sort order only.
//   • Confidence summary is DERIVED on read, never stored as a separate column.
//   • Ungrounded claims must be suppressed (caller obligation; this module returns the axes).
//   • No mutation side-effects from this module; pure functions only.
//   • All operator-tunable constants live in this file (auditable PR-only changes).

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Claim taxonomy
// ─────────────────────────────────────────────────────────────────────────────
export type ClaimType =
  | "retrieved_fact"
  | "inferred_relationship"
  | "analyst_confirmed_assessment"
  | "ai_generated_hypothesis";

// ─────────────────────────────────────────────────────────────────────────────
// §3.2 — Source surfaces + provenance weights (operator-tunable, §8).
// ─────────────────────────────────────────────────────────────────────────────
export type SourceSurface =
  | "analyst_confirmed"
  | "audited_monitor_allowlist"
  | "tenant_document"
  | "poi_investigation"
  | "case_investigation"
  | "audited_monitor_openweb"
  | "quarantined"
  | "ai_only";

export const PROVENANCE_WEIGHTS: Record<SourceSurface, number> = {
  analyst_confirmed:         1.00,
  audited_monitor_allowlist: 0.85,
  tenant_document:           0.80,
  poi_investigation:         0.75,
  case_investigation:        0.75,
  audited_monitor_openweb:   0.55,
  quarantined:               0.00,
  ai_only:                   0.00,
};

// ─────────────────────────────────────────────────────────────────────────────
// §3.1, §3.3, §8, §A1.1 — operator-tunable parameters.
// ─────────────────────────────────────────────────────────────────────────────
export const CORROB_CAP = 5;
export const FRESHNESS_HALF_LIFE_DAYS = {
  operational: 14,
  attribute:   180,
  relationship: 365,
  document:    Number.POSITIVE_INFINITY,
} as const;
export type ClaimClass = keyof typeof FRESHNESS_HALF_LIFE_DAYS;

export const STALE_THRESHOLD = 0.4;

// §3.7 internal composite weights — sort order ONLY, never displayed.
export const COMPOSITE_WEIGHTS = {
  corroboration:      0.35,
  provenance_quality: 0.30,
  freshness:          0.20,
  validation_state:   0.15,
  trajectory_floor:   0.7, // (0.7 + 0.3·trajectory_or_1)
  trajectory_span:    0.3,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type ValidationState =
  | "not_yet_reviewed"
  | "in_review"
  | "accepted"
  | "rejected"
  | "needs_more_info"
  | "withdrawn"
  | "superseded";

export interface SourceRecord {
  /** §3.2 source-type label. */
  surface: SourceSurface;
  /**
   * §3.1 lineage fingerprint — caller-computed identity that distinguishes
   * independent provenance lineages. e.g. `host(url) + canonical_path`,
   * sha256(doc_content), `investigation:<id>`. Two records with the same
   * fingerprint count as ONE lineage.
   */
  lineage_fingerprint: string;
  /** ISO timestamp of when the source was last observed/refreshed. */
  observed_at: string;
  /** Reference id back to the source record for drill-down. */
  ref?: { kind: string; id?: string; url?: string };
}

export interface ConfidenceAxes {
  corroboration:        number;            // 0..1
  provenance_quality:   number;            // 0..1
  freshness:            number;            // 0..1
  validation_state:     ValidationState;
  trajectory_confidence: number | null;     // null = n/a
  grounded:             boolean;
}

/** §A1.1 — confidence summary headline. */
export type ConfidenceSummary =
  | "ungrounded"
  | "hypothesis"
  | "inferred"
  | "single-source"
  | "stale"
  | "well-attested"
  | "confirmed";

// ─────────────────────────────────────────────────────────────────────────────
// §3.1 — corroboration: count of DISTINCT lineages.
// ─────────────────────────────────────────────────────────────────────────────
export function dedupeProvenanceLineages(sources: SourceRecord[]): string[] {
  const seen = new Set<string>();
  for (const s of sources) seen.add(s.lineage_fingerprint);
  return [...seen];
}

export function scoreCorroboration(sources: SourceRecord[]): number {
  const lineages = dedupeProvenanceLineages(sources).length;
  return Math.min(1, lineages / CORROB_CAP);
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.2 — provenance quality: MAXIMUM weight across sources (adding low does not lower high).
// ─────────────────────────────────────────────────────────────────────────────
export function scoreProvenanceQuality(sources: SourceRecord[]): number {
  let best = 0;
  for (const s of sources) {
    const w = PROVENANCE_WEIGHTS[s.surface] ?? 0;
    if (w > best) best = w;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.3 — freshness: exponential decay on MOST RECENT supporting evidence.
// ─────────────────────────────────────────────────────────────────────────────
export function scoreFreshness(
  sources: SourceRecord[],
  claimClass: ClaimClass,
  now: Date = new Date(),
): number {
  if (sources.length === 0) return 0;
  const halfLife = FRESHNESS_HALF_LIFE_DAYS[claimClass];
  if (!isFinite(halfLife)) return 1; // document class — no decay
  let mostRecent = -Infinity;
  for (const s of sources) {
    const t = new Date(s.observed_at).getTime();
    if (Number.isFinite(t) && t > mostRecent) mostRecent = t;
  }
  if (!Number.isFinite(mostRecent)) return 0;
  const ageDays = Math.max(0, (now.getTime() - mostRecent) / (24 * 3600 * 1000));
  const score = Math.pow(0.5, ageDays / halfLife);
  return Math.max(0, Math.min(1, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.4 — validation state: numeric form for the internal composite only.
// ─────────────────────────────────────────────────────────────────────────────
export function validationStateNumeric(s: ValidationState): number {
  return s === "accepted" ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.7 — internal composite (sort order only; never displayed as a number).
// ─────────────────────────────────────────────────────────────────────────────
export function internalComposite(axes: ConfidenceAxes): number {
  if (!axes.grounded) return 0;
  const w = COMPOSITE_WEIGHTS;
  const core =
    w.corroboration      * axes.corroboration +
    w.provenance_quality * axes.provenance_quality +
    w.freshness          * axes.freshness +
    w.validation_state   * validationStateNumeric(axes.validation_state);
  const traj = axes.trajectory_confidence ?? 1;
  const trajMul = w.trajectory_floor + w.trajectory_span * traj;
  return core * trajMul;
}

// ─────────────────────────────────────────────────────────────────────────────
// §A1.1 — confidence summary (DERIVED, never persisted).
// ─────────────────────────────────────────────────────────────────────────────
export function summarizeConfidence(
  claimType: ClaimType,
  axes: ConfidenceAxes,
): ConfidenceSummary {
  if (!axes.grounded) return "ungrounded";
  if (claimType === "ai_generated_hypothesis") return "hypothesis";
  if (claimType === "inferred_relationship" && axes.validation_state !== "accepted") return "inferred";

  if (axes.validation_state === "accepted") {
    return axes.freshness < STALE_THRESHOLD ? "stale" : "confirmed";
  }
  if (axes.corroboration < 0.4) return "single-source";
  if (axes.freshness < STALE_THRESHOLD) return "stale";
  if (axes.provenance_quality >= 0.7) return "well-attested";
  return "single-source";
}

// ─────────────────────────────────────────────────────────────────────────────
// Score a claim end-to-end given its sources + metadata.
// ─────────────────────────────────────────────────────────────────────────────
export interface ScoreClaimInput {
  claim_type: ClaimType;
  claim_class: ClaimClass;
  sources: SourceRecord[];
  validation_state?: ValidationState;
  trajectory_confidence?: number | null;
  /** Caller's grounding determination (Flight Recorder linkage). */
  grounded: boolean;
  /** Optional override clock for deterministic tests. */
  now?: Date;
}

export function scoreClaim(input: ScoreClaimInput): ConfidenceAxes {
  return {
    corroboration:        scoreCorroboration(input.sources),
    provenance_quality:   scoreProvenanceQuality(input.sources),
    freshness:            scoreFreshness(input.sources, input.claim_class, input.now),
    validation_state:     input.validation_state ?? "not_yet_reviewed",
    trajectory_confidence: input.trajectory_confidence ?? null,
    grounded:             input.grounded,
  };
}
