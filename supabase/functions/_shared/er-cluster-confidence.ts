// =============================================================================
// ER v1 Slice 2 — Predicate-based Cluster Confidence aggregation
// =============================================================================
//
// Mirrors the Coverage Confidence Measurement Model (Task #164, prod): no
// opaque weighting; predicates over per-axis evidence; class is selected by a
// short rule sequence operators can audit.
//
// SUFFICIENCY-FIRST RULE (operator amendment 2026-06-01):
//
//   "If evidence volume is insufficient for a reliable comparison, return
//    UNKNOWN rather than LOW. Insufficient evidence is not weak evidence."
//
// Therefore: the sufficiency gate runs BEFORE the predicate aggregation.
// Failing the gate → UNKNOWN, full stop. LOW is reserved for "we looked with
// enough data and the evidence did not suggest these are the same actor."
//
// Operator-readable rationale strings are mandatory. The operator must be able
// to read the rationale and explain why this class was selected — without
// consulting any other surface.

import type {
  AxesEvidenceV1,
  ClusterConfidence,
  PostingTimeEvidence,
  VocabularyEvidence,
  SourceClassEvidence,
  SufficiencyResult,
} from "./er-axes/_evidence-schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// §A — Sufficiency gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum number of axes that must return status="computed" for any non-UNKNOWN
 * classification to be allowed. Per operator amendment 2026-06-01.
 *
 * Two-of-three is the right floor:
 *   • If only one axis computes, we cannot triangulate. The lone axis (e.g.,
 *     vocabulary overlap) might be coincidental; without a second corroborating
 *     axis we cannot ascribe it to "same actor."
 *   • Requiring all three would over-stub: legitimate strong overlap on 2 axes
 *     would land as UNKNOWN if the third axis happens to be sparse.
 *   • Two-of-three lets at most one axis be sparse, so triangulation is
 *     preserved while honoring the operator's intent.
 */
export const SUFFICIENCY_MIN_COMPUTED_AXES = 2;

export function evaluateSufficiency(
  postingTime: PostingTimeEvidence,
  vocabulary: VocabularyEvidence,
  sourceClass: SourceClassEvidence,
): SufficiencyResult {
  const computedNames: string[] = [];
  const insufficientNames: string[] = [];

  if (postingTime.status === "computed") computedNames.push("posting_time");
  else insufficientNames.push("posting_time");
  if (vocabulary.status === "computed") computedNames.push("vocabulary");
  else insufficientNames.push("vocabulary");
  if (sourceClass.status === "computed") computedNames.push("source_class");
  else insufficientNames.push("source_class");

  const computed_axes_count = computedNames.length;
  const passed = computed_axes_count >= SUFFICIENCY_MIN_COMPUTED_AXES;

  let reason: string;
  if (passed) {
    reason = `sufficient: ${computed_axes_count}/3 axes computed (${computedNames.join(", ")})`;
  } else {
    reason =
      `insufficient: only ${computed_axes_count}/3 axes computed; ` +
      `${insufficientNames.join(", ")} lacked sufficient samples`;
  }

  return { passed, reason, computed_axes_count };
}

// ─────────────────────────────────────────────────────────────────────────────
// §B — Predicate aggregation (runs ONLY when sufficiency gate passes)
// ─────────────────────────────────────────────────────────────────────────────
//
// Class ladder, top-down:
//
//   HIGH    := all axes that ARE computed exceed STRONG threshold AND
//              at least one axis emits has_high_confidence_evidence
//              AND axes_computed_count == 3 (all three present)
//
//   MEDIUM  := ≥2 of the computed axes exceed MODERATE threshold
//
//   LOW     := sufficient axes computed, but the MEDIUM predicate is not met
//
//   UNKNOWN := only reachable via the sufficiency gate (never here)
//
// Tied/ambiguous results resolve toward the LOWER class, never the higher one.

export interface PredicateAggregationInput {
  postingTime: PostingTimeEvidence;
  vocabulary: VocabularyEvidence;
  sourceClass: SourceClassEvidence;
}

export function runPredicateAggregation(
  input: PredicateAggregationInput,
): ClusterConfidence {
  const axes = [input.postingTime, input.vocabulary, input.sourceClass];
  const computed = axes.filter((a) => a.status === "computed");

  const axes_computed_count = computed.length;
  const axes_exceeding_moderate = computed.filter((a) => a.exceeds_moderate).length;
  const axes_exceeding_strong = computed.filter((a) => a.exceeds_strong).length;
  const has_high_confidence_evidence = computed.some(
    (a) => a.has_high_confidence_evidence === true,
  );

  let cls: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  let rationale: string;

  if (
    axes_computed_count === 3 &&
    axes_exceeding_strong === 3 &&
    has_high_confidence_evidence
  ) {
    cls = "HIGH";
    rationale =
      `HIGH: all 3 axes computed and exceed STRONG threshold; ` +
      `at least one axis emits high-confidence evidence`;
  } else if (axes_exceeding_moderate >= 2) {
    cls = "MEDIUM";
    const which = [
      input.postingTime.exceeds_moderate ? "posting_time" : null,
      input.vocabulary.exceeds_moderate ? "vocabulary" : null,
      input.sourceClass.exceeds_moderate ? "source_class" : null,
    ].filter(Boolean).join(" + ");
    rationale = `MEDIUM: ${axes_exceeding_moderate}/3 axes exceeded MODERATE threshold (${which})`;
  } else {
    cls = "LOW";
    rationale =
      `LOW: ${axes_computed_count}/3 axes computed; ` +
      `${axes_exceeding_moderate}/3 axes exceeded MODERATE — not enough corroboration`;
  }

  return {
    cluster_confidence_class: cls,
    rationale,
    predicates: {
      axes_computed_count,
      axes_exceeding_moderate,
      axes_exceeding_strong,
      has_high_confidence_evidence,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — Combined sufficiency-first cluster verdict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full ClusterConfidence verdict + sufficiency block.
 *
 * Honors the UNKNOWN-first rule: if sufficiency gate fails, the class is
 * UNKNOWN and the rationale explains which axes were thin. The predicate
 * aggregation still runs (for audit) but its class is overridden to UNKNOWN.
 */
export function deriveClusterConfidence(
  postingTime: PostingTimeEvidence,
  vocabulary: VocabularyEvidence,
  sourceClass: SourceClassEvidence,
): { sufficiency: SufficiencyResult; cluster_confidence: ClusterConfidence } {
  const sufficiency = evaluateSufficiency(postingTime, vocabulary, sourceClass);

  const aggregated = runPredicateAggregation({ postingTime, vocabulary, sourceClass });

  if (!sufficiency.passed) {
    return {
      sufficiency,
      cluster_confidence: {
        cluster_confidence_class: "UNKNOWN",
        rationale: `UNKNOWN: ${sufficiency.reason}`,
        // Keep predicate counts for audit; the class is UNKNOWN because of sufficiency.
        predicates: aggregated.predicates,
      },
    };
  }

  return { sufficiency, cluster_confidence: aggregated };
}

// ─────────────────────────────────────────────────────────────────────────────
// §D — Final assembly into AxesEvidenceV1
// ─────────────────────────────────────────────────────────────────────────────

export interface AssembleInput {
  tenant_id: string;
  entity_a_id: string;
  entity_b_id: string;
  flight_recorder_trace_id: string | null;
  postingTime: PostingTimeEvidence;
  vocabulary: VocabularyEvidence;
  sourceClass: SourceClassEvidence;
  /** Optional override; defaults to `new Date().toISOString()`. Used for test determinism. */
  now?: () => Date;
}

export function assembleAxesEvidence(input: AssembleInput): AxesEvidenceV1 {
  const { sufficiency, cluster_confidence } = deriveClusterConfidence(
    input.postingTime, input.vocabulary, input.sourceClass,
  );
  return {
    v: 1,
    computed_at: (input.now?.() ?? new Date()).toISOString(),
    tenant_id: input.tenant_id,
    entity_a_id: input.entity_a_id,
    entity_b_id: input.entity_b_id,
    flight_recorder_trace_id: input.flight_recorder_trace_id,
    sufficiency,
    axes: {
      posting_time: input.postingTime,
      vocabulary: input.vocabulary,
      source_class: input.sourceClass,
    },
    cluster_confidence,
  };
}
