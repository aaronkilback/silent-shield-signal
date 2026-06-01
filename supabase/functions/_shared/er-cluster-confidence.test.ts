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
  assert(r.rationale.startsWith("HIGH"));
});

Deno.test("predicate aggregation: all-3 strong but no high-confidence → MEDIUM", () => {
  // Strong overlap without an axis flagged as has_high_confidence_evidence
  // should NOT promote to HIGH; this keeps HIGH rare.
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
  assertEquals(r.cluster_confidence_class, "MEDIUM");
  assertEquals(r.predicates.axes_exceeding_strong, 3);
  assertEquals(r.predicates.has_high_confidence_evidence, false);
});

Deno.test("predicate aggregation: 2/3 axes moderate → MEDIUM", () => {
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: true, exceeds_strong: false }),
    vocabulary: computedVocabulary({ exceeds_moderate: true, exceeds_strong: false }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  });
  assertEquals(r.cluster_confidence_class, "MEDIUM");
  assertEquals(r.predicates.axes_exceeding_moderate, 2);
});

Deno.test("predicate aggregation: 0 axes moderate → LOW", () => {
  const r = runPredicateAggregation({
    postingTime: computedPostingTime({ exceeds_moderate: false, exceeds_strong: false }),
    vocabulary: computedVocabulary({ exceeds_moderate: false, exceeds_strong: false }),
    sourceClass: computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  });
  assertEquals(r.cluster_confidence_class, "LOW");
  assert(r.rationale.startsWith("LOW"));
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
  assert(result.cluster_confidence.rationale.startsWith("UNKNOWN"));
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

Deno.test("sufficient + 2 moderate → MEDIUM", () => {
  const result = deriveClusterConfidence(
    computedPostingTime({ exceeds_moderate: true, exceeds_strong: false }),
    computedVocabulary({ exceeds_moderate: true, exceeds_strong: false }),
    computedSourceClass({ exceeds_moderate: false, exceeds_strong: false }),
  );
  assertEquals(result.sufficiency.passed, true);
  assertEquals(result.cluster_confidence.cluster_confidence_class, "MEDIUM");
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
  // Class with this combination: 2 moderates (posting_time + vocab) + 1 strong (source_class)
  // → MEDIUM (2/3 exceed moderate)
  assertEquals(evidence.cluster_confidence.cluster_confidence_class, "MEDIUM");
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
