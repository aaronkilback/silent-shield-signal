// _shared/shadow-scorer.ts — WO-GATE-PHASE3-SHADOW-PLAN, Requirements 2 + 3 (slice 3 of 7).
//
// PURE + WRITE-ISOLATED. No DB, no network. Replicates the composite/tier-2 scoring and the
// RECALIBRATED severity for the shadow, WITHOUT calling the live ai-decision-engine (which would
// dispatch/write). It imports the CANONICAL `computeComposite` from signal-scores.ts so the shadow
// composite can never drift from the live formula.

import { computeComposite } from "./signal-scores.ts";

export const TIER2_THRESHOLD = 0.60; // composite >= 0.60 would dispatch to review-signal-agent

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Shadow composite_confidence. The live path feeds computeComposite with ai_confidence,
 * relevance_score, and source_credibility. In shadow mode we do NOT run the live AI relevance
 * scorer (cost + it can dispatch), so we use documented PROXIES and the CANONICAL formula:
 *   • relevance_score  ← the matcher's confidence (token/asset_geo/semantic)
 *   • ai_confidence    ← the semantic classifier's confidence when the semantic leg ran, else the
 *                        matcher confidence (token/asset matches carry no independent AI confidence)
 *   • source_credibility ← 0.5 provisional prior (identical to ingest-signal's persist-time prior)
 * Goal is composite COVERAGE (~100% of shadow-matched items get a composite) using the real formula;
 * fidelity to the live per-item value is reported, not assumed, in the 7-day compare.
 */
export function shadowComposite(input: {
  matchConfidence: number | null;
  aiConfidence?: number | null;
  sourceCredibility?: number | null;
}): number {
  return computeComposite({
    ai_confidence: input.aiConfidence ?? input.matchConfidence,
    relevance_score: input.matchConfidence,
    source_credibility: input.sourceCredibility ?? 0.5,
  });
}

export function tier2Eligible(composite: number | null): boolean {
  return composite != null && composite >= TIER2_THRESHOLD;
}

/**
 * Recalibrated shadow severity (Requirement 3). The live gate maps a single model score to
 * critical(>=80)/high(>=50); ~88% of RSS signals land high+critical. The recalibration:
 *   • CRITICAL requires corroboration — >= 2 independent source domains, OR cross-source
 *     confirmation, OR an incident linkage. NEVER a single model score. An uncorroborated
 *     model-"critical" is demoted to high.
 *   • HIGH stands only with corroboration or a solid composite; otherwise demoted to medium.
 * This structurally pulls high+critical toward the ~18% ceiling (#83 precedent) because most
 * single-source RSS items are uncorroborated. The actual resulting distribution is REPORTED in the
 * 7-day compare, not asserted here.
 */
export function shadowSeverity(input: {
  modelSeverity: Severity | null;
  compositeConfidence: number | null;
  corroborationCount: number;      // independent corroborating source domains
  hasIncidentLinkage?: boolean;
  hasCrossSource?: boolean;
}): { severity: Severity; basis: string } {
  const corr = input.corroborationCount ?? 0;
  const corroborated = corr >= 2 || !!input.hasIncidentLinkage || !!input.hasCrossSource;
  const comp = input.compositeConfidence ?? 0;
  const why = `corr=${corr}${input.hasIncidentLinkage ? "+incident" : ""}${input.hasCrossSource ? "+xsource" : ""}`;

  switch (input.modelSeverity) {
    case "critical":
      return corroborated
        ? { severity: "critical", basis: `critical: corroborated (${why})` }
        : { severity: "high", basis: `demoted critical->high: uncorroborated single-source model score (${why})` };
    case "high":
      return corroborated || comp >= 0.60
        ? { severity: "high", basis: `high: ${corroborated ? `corroborated (${why})` : `composite=${comp}`}` }
        : { severity: "medium", basis: `demoted high->medium: weak composite=${comp}, uncorroborated (${why})` };
    case "medium":
      return { severity: "medium", basis: "medium: model" };
    default:
      return { severity: "low", basis: "low: model/default" };
  }
}

/** Numeric model-severity (0-100, as the live gate produces) → the Severity string used above. */
export function severityFromScore(score: number | null | undefined): Severity {
  const s = score ?? 0;
  return s >= 80 ? "critical" : s >= 50 ? "high" : s >= 20 ? "medium" : "low";
}
