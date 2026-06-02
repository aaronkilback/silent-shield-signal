// Deno tests for the Cluster Confidence aggregation — including the strong
// operator-amendment guarantees:
//
//   • Insufficient evidence → UNKNOWN (never LOW)
//   • LOW only reachable when sufficiency gate passes and aggregation lands LOW
//   • Predicate aggregation is auditable from rationale text
//
// Run with: deno test supabase/functions/_shared/er-cluster-confidence.test.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateSufficiency,
  runPredicateAggregation,
  deriveClusterConfidence,
  assembleAxesEvidence,
  SUFFICIENCY_MIN_COMPUTED_AXES,
} from "./er-cluster-confidence.ts";
import type {
  PostingTimeEvidence,
  VocabularyEvidence,
  SourceClassEvidence,
} from "./er-axes/_evidence-schema.ts";
import {
  EMPTY_POSTING_TIME,
  EMPTY_VOCABULARY,
  EMPTY_SOURCE_CLASS,
} from "./er-axes/_evidence-schema.ts";

// Helper fixtures — minimal valid axes results
function computedPostingTime(overrides: Partial<PostingTimeEvidence> = {}): PostingTimeEvidence {
  return {
    ...EMPTY_POSTING_TIME,
    status: "computed",
    stub_reason: null,
    n_signals_a: 20,
    n_signals_b: 20,
    pearson_r: 0.5,
    most_active_shared_hours: [{ hour_of_week: 38, a_share: 0.1, b_share: 0.1 }],
    evidence_summary: "pearson_r=0.50 …",
    exceeds_moderate: true,
    exceeds_strong: false,
    has_high_confidence_evidence: false,
    ...overrides,
  };
}
function computedVocabulary(overrides: Partial<VocabularyEvidence> = {}): VocabularyEvidence {
  return {
    ...EMPTY_VOCABULARY,
    status: "computed",
    stub_reason: null,
    n_words_a: 500,
    n_words_b: 500,
    top_shared_distinctive_terms: ["alpha", "bravo", "charlie"],
    overlap_ratio: 0.25,
    evidence_summary: "3 shared distinctive terms …",
    exceeds_moderate: true,
    exceeds_strong: false,
    has_high_confidence_evidence: false,
    ...overrides,
  };
}
function computedSourceClass(overrides: Partial<SourceClassEvidence> = {}): SourceClassEvidence {
  return {
    ...EMPTY_SOURCE_CLASS,
    status: "computed",
    stub_reason: null,
    classes_a: ["news", "social_x"],
    classes_b: ["news", "social_x"],
    shared_classes: ["news", "social_x"],
    overlap_ratio: 1,
    evidence_summary: "2 shared classes …",
    exceeds_moderate: true,
    exceeds_strong: true,
    has_high_confidence_evidence: false,
    ...overrides,
  };
}

// =============================================================================
// §A — Sufficiency gate (operator's UNKNOWN-first amendment)
// =============================================================================

Deno.test("sufficiency: 3/3 computed → passed=true", () => {
  const s = evaluateSufficiency(computedPostingTime(), computedVocabulary(), computedSourceClass());
  assertEquals(s.passed, true);
  assertEquals(s.computed_axes_count, 3);
});

Deno.test("sufficiency: 2/3 computed → passed=true (meets floor)", () => {
  const s = evaluateSufficiency(
    computedPostingTime(),
    EMPTY_VOCABULARY,
    computedSourceClass(),
  );
  assertEquals(s.passed, true);
  assertEquals(s.computed_axes_count, 2);
  assert(s.reason.includes("posting_time"));
  assert(s.reason.includes("source_class"));
});

Deno.test("sufficiency: 1/3 computed → passed=false (below floor)", () => {
  const s = evaluateSufficiency(computedPostingTime(), EMPTY_VOCABULARY, EMPTY_SOURCE_CLASS);
  assertEquals(s.passed, false);
  assertEquals(s.computed_axes_count, 1);
  assert(s.reason.includes("vocabulary"));
  assert(s.reason.includes("source_class"));
});

Deno.test("sufficiency: 0/3 computed → passed=false", () => {
  const s = evaluateSufficiency(EMPTY_POSTING_TIME, EMPTY_VOCABULARY, EMPTY_SOURCE_CLASS);
  assertEquals(s.passed, false);
  assertEquals(s.computed_axes_count, 0);
});

Deno.test("sufficiency: floor constant matches operator amendment", () => {
  // The amendment says: "≥2 of 3 axes" is the canonical interpretation.
  assertEquals(SUFFICIENCY_MIN_COMPUTED_AXES, 2);
});

// =============================================================================
// §B — Predicate aggregation (runs only when sufficiency gate passes)
// =============================================================================

Deno.test("predicate aggregation: all-3 strong + high-confidence → HIGH", () => {
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({
      pearson_r: 0.85,
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: true,
    }),
    vocabulary: computedVocabulary({
      top_shared_distinctive_terms: Array.from({ length: 15 }, (_, i) => `term${i}`),
      overlap_ratio: 0.5,
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: true,
    }),
    sourceClass: computedSourceClass(),
  });
  assertEquals(r.cluster_confidence_class, "HIGH");
  assertEquals(r.predicates.axes_exceeding_strong, 3);
  assertEquals(r.predicates.has_high_confidence_evidence, true);
  // G-2: operator-facing rationale leads with the overlap label, not the raw enum.
  assert(r.rationale.startsWith("STRONG OVERLAP"));
});

Deno.test("G-1: all-3 strong but no high-confidence → LOW (was MEDIUM pre-G-1)", () => {
  // G-1 tightening: MEDIUM now requires ≥1 high-confidence axis.
  // 3 strong axes without any high-confidence flag → LOW.
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: false,
    }),
    vocabulary: computedVocabulary({
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: false,
    }),
    sourceClass: computedSourceClass({
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: false,
    }),
  });
  assertEquals(r.cluster_confidence_class, "LOW");
  assert(r.rationale.includes("no axis emits high-confidence evidence"));
  assertEquals(r.predicates.axes_exceeding_strong, 3);
});

Deno.test("G-1 CRITICAL: vocabulary high-confidence ALONE → LOW (domain FP scenario)", () => {
  // The dangerous-failure-mode scenario from the adversarial review:
  // two distinct activists in the same movement share distinctive domain
  // vocabulary (≥10 terms) but no behavioral corroboration.
  // PRE-G-1: this would have produced MEDIUM. POST-G-1: must produce LOW.
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
    vocabulary: computedVocabulary({
      top_shared_distinctive_terms: Array.from({ length: 15 }, (_, i) => `term${i}`),
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: true,
    }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
  });
  // Only 1 axis moderate → cannot meet MEDIUM's "≥2 moderate" floor.
  assertEquals(r.cluster_confidence_class, "LOW");
});

Deno.test("G-1: vocabulary high-confidence + posting-time moderate (no high-conf) → MEDIUM", () => {
  // 2 axes moderate + 1 high-confidence axis (vocab) + 1 behavioral axis (posting-time) moderate
  // = all three G-1 predicates met → MEDIUM.
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: true, exceeds_strong: false, has_high_confidence_evidence: false }),
    vocabulary: computedVocabulary({
      top_shared_distinctive_terms: Array.from({ length: 12 }, (_, i) => `term${i}`),
      exceeds_moderate: true, exceeds_strong: false, has_high_confidence_evidence: true,
    }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
  });
  assertEquals(r.cluster_confidence_class, "MEDIUM");
  assertEquals(r.predicates.behavioral_axes_moderate, 1);
});

Deno.test("G-1: vocabulary moderate + source-class moderate, NO high-confidence → LOW", () => {
  // 2 moderates but no axis emits has_high_confidence_evidence.
  // PRE-G-1: this would have produced MEDIUM. POST-G-1: LOW.
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
    vocabulary: computedVocabulary({ exceeds_moderate: true, exceeds_strong: false, has_high_confidence_evidence: false }),
    sourceClass: computedSourceClass({ exceeds_moderate: true, exceeds_strong: false, has_high_confidence_evidence: false }),
  });
  assertEquals(r.cluster_confidence_class, "LOW");
});

Deno.test("G-1: 2 moderates BUT all topical (vocab only behavior with no behavioral) → LOW", () => {
  // This codifies the explicit topical-vs-behavioral rule.
  // Impossible at present because there's only ONE topical axis (vocabulary)
  // and 2 moderates requires it + at least one behavioral. The test is a
  // belt+suspenders guard if future schema adds more topical axes.
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
    vocabulary: computedVocabulary({
      exceeds_moderate: true, exceeds_strong: false,
      top_shared_distinctive_terms: Array.from({ length: 12 }, (_, i) => `term${i}`),
      has_high_confidence_evidence: true,
    }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false, has_high_confidence_evidence: false }),
  });
  // Only 1 axis moderate (vocabulary) — fails MEDIUM's "≥2 moderate" base predicate.
  assertEquals(r.cluster_confidence_class, "LOW");
  assertEquals(r.predicates.behavioral_axes_moderate, 0);
});

Deno.test("predicate aggregation: 0 axes moderate → LOW", () => {
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: false, exceeds_strong: false }),
    vocabulary: computedVocabulary({ exceeds_moderate: false, exceeds_strong: false }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  });
  assertEquals(r.cluster_confidence_class, "LOW");
  // G-2: rationale leads with the overlap label.
  assert(r.rationale.startsWith("WEAK OVERLAP"));
});

Deno.test("predicate aggregation: 1/3 axes moderate → LOW (not enough corroboration)", () => {
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: true, exceeds_strong: false }),
    vocabulary: computedVocabulary({ exceeds_moderate: false, exceeds_strong: false }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  });
  assertEquals(r.cluster_confidence_class, "LOW");
  assertEquals(r.predicates.axes_exceeding_moderate, 1);
});

// =============================================================================
// §C — Combined sufficiency-first verdict (the operator amendment in action)
// =============================================================================

Deno.test("CRITICAL: insufficient sufficiency → UNKNOWN, NEVER LOW (operator amendment)", () => {
  // Only one axis computes, and it lands STRONG. Without sufficiency, this MUST
  // be UNKNOWN — not HIGH, not MEDIUM, not LOW. Insufficient evidence is not
  // weak evidence and is not strong evidence either.
  const result = deriveClusterConfidence(
    computedPostingTime({
      exceeds_moderate: true, exceeds_strong: true, has_high_confidence_evidence: true,
    }),
    EMPTY_VOCABULARY,
    EMPTY_SOURCE_CLASS,
  );
  assertEquals(result.sufficiency.passed, false);
  assertEquals(result.cluster_confidence.cluster_confidence_class, "UNKNOWN");
  // G-2: UNKNOWN rationale leads with the operator-facing label.
  assert(result.cluster_confidence.rationale.startsWith("INSUFFICIENT EVIDENCE"));
  // Predicate counts are preserved for audit
  assertEquals(result.cluster_confidence.predicates.axes_computed_count, 1);
  assertEquals(result.cluster_confidence.predicates.axes_exceeding_strong, 1);
});

Deno.test("sufficient + 0 moderate → LOW (the 'we looked and found nothing' state)", () => {
  const result = deriveClusterConfidence(
    computedPostingTime({ exceeds_moderate: false, exceeds_strong: false }),
    computedVocabulary({ exceeds_moderate: false, exceeds_strong: false }),
    computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  );
  assertEquals(result.sufficiency.passed, true);
  assertEquals(result.cluster_confidence.cluster_confidence_class, "LOW");
});

Deno.test("G-1: sufficient + 2 moderate but NO high-confidence axis → LOW (was MEDIUM pre-G-1)", () => {
  // G-1 tightening: 2 moderate axes are no longer sufficient for MEDIUM on their
  // own — MEDIUM additionally requires ≥1 high-confidence axis + behavioral
  // corroboration. With neither high-confidence flag set, this is WEAK OVERLAP.
  const result = deriveClusterConfidence(
    computedPostingTime({ exceeds_moderate: true, exceeds_strong: false }),
    computedVocabulary({ exceeds_moderate: true, exceeds_strong: false }),
    computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  );
  assertEquals(result.sufficiency.passed, true);
  assertEquals(result.cluster_confidence.cluster_confidence_class, "LOW");
});

// =============================================================================
// §D — Final AxesEvidenceV1 assembly
// =============================================================================

Deno.test("assembleAxesEvidence: produces v:1 with all required fields", () => {
  const fixedNow = () => new Date("2026-06-01T15:00:00Z");
  const evidence = assembleAxesEvidence({
    tenant_id: "00000000-0000-0000-0000-000000000001",
    entity_a_id: "11111111-1111-1111-1111-111111111111",
    entity_b_id: "22222222-2222-2222-2222-222222222222",
    flight_recorder_trace_id: "trace-abc",
    postingTime: computedPostingTime(),
    vocabulary: computedVocabulary(),
    sourceClass: computedSourceClass(),
    now: fixedNow,
  });
  assertEquals(evidence.v, 1);
  assertEquals(evidence.computed_at, "2026-06-01T15:00:00.000Z");
  assertEquals(evidence.tenant_id, "00000000-0000-0000-0000-000000000001");
  assertEquals(evidence.flight_recorder_trace_id, "trace-abc");
  assertEquals(evidence.sufficiency.passed, true);
  // Class with this combination: 3 moderate (posting_time + vocab + source_class)
  // but NO axis emits high-confidence evidence → G-1 caps this at LOW (WEAK OVERLAP),
  // since MEDIUM requires a high-confidence axis + behavioral corroboration.
  assertEquals(evidence.cluster_confidence.cluster_confidence_class, "LOW");
  // All three axis blocks must be present
  assert(evidence.axes.posting_time);
  assert(evidence.axes.vocabulary);
  assert(evidence.axes.source_class);
});

Deno.test("assembleAxesEvidence: insufficient sufficiency forces UNKNOWN in final output", () => {
  const evidence = assembleAxesEvidence({
    tenant_id: "00000000-0000-0000-0000-000000000001",
    entity_a_id: "11111111-1111-1111-1111-111111111111",
    entity_b_id: "22222222-2222-2222-2222-222222222222",
    flight_recorder_trace_id: null,
    postingTime: EMPTY_POSTING_TIME,
    vocabulary: EMPTY_VOCABULARY,
    sourceClass: computedSourceClass({ exceeds_strong: true, exceeds_moderate: true }),
  });
  assertEquals(evidence.sufficiency.passed, false);
  assertEquals(evidence.cluster_confidence.cluster_confidence_class, "UNKNOWN");
});
