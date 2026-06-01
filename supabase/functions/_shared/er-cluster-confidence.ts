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
  ClusterConfidenceClass,
  EvidenceStrengthLabel,
  PostingTimeEvidence,
  VocabularyEvidence,
  SourceClassEvidence,
  SufficiencyResult,
} from "./er-axes/_evidence-schema.ts";
import { CLASS_MEANING } from "./er-axes/_evidence-schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// G-1 (2026-06-01) — Axis taxonomy: distinguish topical vs behavioral evidence.
//
// Why this matters: domain-clustered actors (e.g., two distinct activists in
// the same movement) WILL share distinctive vocabulary terms. Vocabulary alone
// — even at high-confidence levels — produces false positives on domain-shared
// pairs. The tightened predicate requires a behavioral axis to corroborate
// before MODERATE OVERLAP can be claimed.
// ─────────────────────────────────────────────────────────────────────────────

/** Axes that measure WHAT an actor talks about (susceptible to domain FP). */
const TOPICAL_AXES = ["vocabulary"] as const;

/** Axes that measure HOW an actor behaves (more identity-bearing). */
const BEHAVIORAL_AXES = ["posting_time", "source_class"] as const;

/** Maps the persisted enum class to the operator-facing overlap label. */
export function evidenceStrengthLabel(cls: ClusterConfidenceClass): EvidenceStrengthLabel {
  switch (cls) {
    case "HIGH":    return "STRONG OVERLAP";
    case "MEDIUM":  return "MODERATE OVERLAP";
    case "LOW":     return "WEAK OVERLAP";
    case "UNKNOWN": return "INSUFFICIENT EVIDENCE";
  }
}

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

  // G-1: count BEHAVIORAL axes specifically (posting_time + source_class).
  const behavioral_axes_moderate =
    (input.postingTime.exceeds_moderate ? 1 : 0) +
    (input.sourceClass.exceeds_moderate ? 1 : 0);

  let cls: ClusterConfidenceClass = "LOW";
  let rationale: string;

  if (
    axes_computed_count === 3 &&
    axes_exceeding_strong === 3 &&
    has_high_confidence_evidence
  ) {
    cls = "HIGH";
    rationale =
      `STRONG OVERLAP: all 3 axes exceeded STRONG threshold; ≥1 axis emits ` +
      `high-confidence evidence. Operator confirmation required to assert identity.`;
  } else if (
    axes_exceeding_moderate >= 2 &&
    has_high_confidence_evidence &&        // G-1: high-confidence axis required
    behavioral_axes_moderate >= 1          // G-1: behavioral corroboration required
  ) {
    cls = "MEDIUM";
    const which = [
      input.postingTime.exceeds_moderate ? "posting_time" : null,
      input.vocabulary.exceeds_moderate ? "vocabulary" : null,
      input.sourceClass.exceeds_moderate ? "source_class" : null,
    ].filter(Boolean).join(" + ");
    rationale =
      `MODERATE OVERLAP: ${axes_exceeding_moderate}/3 axes exceeded MODERATE ` +
      `(${which}), ≥1 axis emits high-confidence evidence, and behavioral ` +
      `corroboration is present (not topical alone). Operator confirmation ` +
      `required to assert identity.`;
  } else if (
    axes_exceeding_moderate >= 2 &&
    !has_high_confidence_evidence
  ) {
    cls = "LOW";
    rationale =
      `WEAK OVERLAP: ${axes_exceeding_moderate}/3 axes exceeded MODERATE but ` +
      `no axis emits high-confidence evidence — possible domain or topic ` +
      `overlap without identity match.`;
  } else if (
    axes_exceeding_moderate >= 2 &&
    behavioral_axes_moderate === 0
  ) {
    cls = "LOW";
    rationale =
      `WEAK OVERLAP: ${axes_exceeding_moderate}/3 axes exceeded MODERATE but ` +
      `only on topical evidence (vocabulary); behavioral corroboration ` +
      `(posting time / source diversity) is absent. Topic-shared actors are ` +
      `not the same actor.`;
  } else {
    cls = "LOW";
    rationale =
      `WEAK OVERLAP: ${axes_computed_count}/3 axes computed; ` +
      `${axes_exceeding_moderate}/3 axes exceeded MODERATE — not enough ` +
      `corroboration to suggest moderate overlap.`;
  }

  return {
    cluster_confidence_class: cls,
    evidence_strength_label: evidenceStrengthLabel(cls),
    class_meaning: CLASS_MEANING,
    rationale,
    predicates: {
      axes_computed_count,
      axes_exceeding_moderate,
      axes_exceeding_strong,
      has_high_confidence_evidence,
      behavioral_axes_moderate,
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
        evidence_strength_label: evidenceStrengthLabel("UNKNOWN"),
        class_meaning: CLASS_MEANING,
        rationale: `INSUFFICIENT EVIDENCE: ${sufficiency.reason}. ` +
          `Insufficient evidence is not weak evidence — re-evaluate once more ` +
          `signals are collected for the thinly-covered entities.`,
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
