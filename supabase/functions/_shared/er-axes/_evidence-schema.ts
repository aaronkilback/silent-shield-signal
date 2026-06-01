// =============================================================================
// ER v1 Slice 2 — Versioned `axes_evidence` schema (v: 1)
// =============================================================================
//
// Authorization: Operator GO 2026-06-01 for Slice 2. Includes the strong
// sufficiency-first amendment:
//   "If evidence volume is insufficient for a reliable comparison, return
//    UNKNOWN rather than LOW. Insufficient evidence is not weak evidence."
//
// Contract guarantees:
//   • Every field that contributes to operator review is human-readable.
//   • Per-axis evidence is concrete (numbers, term lists, source-class lists) —
//     never an opaque score. The operator must be able to read this object and
//     explain WHY the suggested relationship exists.
//   • Schema is versioned. Any breaking change requires a new `v:` integer
//     and a documented consumer migration (Aegis chat / workspace UI).
//
// This file defines the shape only. Computation lives in the axis modules and
// `er-cluster-confidence.ts`. Persistence lives in `er-write-suggestion.ts`.

/** Status a single axis can land in. */
export type AxisStatus = "computed" | "insufficient_samples";

/** One axis's verdict relative to operator-tunable thresholds. */
export interface AxisThresholdResult {
  /**
   * True when the axis's overlap signal exceeds the "moderate" threshold.
   * Threshold constants live in each axis module and are operator-tunable
   * (changes require a PR + operator sign-off per Workstream D convention).
   */
  exceeds_moderate: boolean;
  /** True when the axis's overlap signal exceeds the "strong" threshold. */
  exceeds_strong: boolean;
  /**
   * Optional flag — true when this axis emits a particularly high-confidence
   * piece of evidence (e.g., posting-time pearson_r ≥ 0.7, vocabulary shared
   * distinctive-term count ≥ 10). Promotes a cluster from MEDIUM toward HIGH
   * per the predicate aggregation in `er-cluster-confidence.ts`.
   */
  has_high_confidence_evidence?: boolean;
}

/** Posting-time axis evidence — concrete enough to read aloud. */
export interface PostingTimeEvidence extends AxisThresholdResult {
  status: AxisStatus;
  /** Populated only when `status === "insufficient_samples"`. */
  stub_reason: string | null;
  /** Total non-quarantined signals retrieved for entity A in the window. */
  n_signals_a: number;
  /** Total non-quarantined signals retrieved for entity B in the window. */
  n_signals_b: number;
  /**
   * Pearson correlation coefficient over the 168-hour-week activity vectors.
   * Range [-1, 1]. NaN when either vector has zero variance — represented as
   * `null` in JSON to keep the schema typed.
   */
  pearson_r: number | null;
  /**
   * Top hours-of-week where BOTH actors were most active. Hours are 0-167
   * (UTC; 0 = Monday 00:00). Empty array when status is insufficient_samples.
   */
  most_active_shared_hours: { hour_of_week: number; a_share: number; b_share: number }[];
  /**
   * One-line operator-readable summary, e.g.:
   *   "both actors active Mon-Fri 14:00-22:00 UTC; pearson_r=0.74 over 42/38 signals"
   * Empty when insufficient samples.
   */
  evidence_summary: string;
}

/** Vocabulary axis evidence — distinctive shared terms, never opaque. */
export interface VocabularyEvidence extends AxisThresholdResult {
  status: AxisStatus;
  stub_reason: string | null;
  /** Total token count across all signals for entity A. */
  n_words_a: number;
  /** Total token count across all signals for entity B. */
  n_words_b: number;
  /**
   * Top shared distinctive terms — verbatim words/phrases the operator can
   * read. Order: by joint-distinctive score descending. Capped at 20 to
   * keep evidence reviewable.
   */
  top_shared_distinctive_terms: string[];
  /**
   * Jaccard-style overlap ratio over each actor's top-K distinctive terms.
   * Range [0, 1].
   */
  overlap_ratio: number;
  evidence_summary: string;
}

/** Source-class axis evidence — concrete source-class lists. */
export interface SourceClassEvidence extends AxisThresholdResult {
  status: AxisStatus;
  stub_reason: string | null;
  /** Source classes entity A appears on, normalized via prod taxonomy. */
  classes_a: string[];
  /** Source classes entity B appears on, normalized via prod taxonomy. */
  classes_b: string[];
  /** Intersection of A's and B's classes. */
  shared_classes: string[];
  /** |intersection| / |union|. Range [0, 1]. */
  overlap_ratio: number;
  evidence_summary: string;
}

/** Sufficiency gate result — fires UNKNOWN-first per operator amendment. */
export interface SufficiencyResult {
  /**
   * True when ≥2 of 3 axes returned `status="computed"`. False otherwise.
   * Per operator 2026-06-01: when this is false, the cluster confidence MUST
   * be UNKNOWN — never LOW. Insufficient evidence is not weak evidence.
   */
  passed: boolean;
  /**
   * Human-readable reason. When `passed=false`, names the axes that lacked
   * samples (e.g., "vocabulary + source_class lacked sufficient samples").
   * When `passed=true`, summarizes what was sufficient.
   */
  reason: string;
  /** Count of axes with status="computed". */
  computed_axes_count: number;
}

/** Predicate-based Cluster Confidence verdict. */
export type ClusterConfidenceClass = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";

export interface ClusterConfidence {
  cluster_confidence_class: ClusterConfidenceClass;
  /**
   * One-line plain-English rationale. Must answer the operator's
   * most-important question: "exactly why this class was selected".
   * Examples:
   *   "UNKNOWN: posting_time + vocabulary lacked sufficient samples"
   *   "LOW: 3 axes computed; no axis exceeded moderate-overlap threshold"
   *   "MEDIUM: posting_time + vocabulary exceeded moderate threshold"
   *   "HIGH: all 3 axes exceeded strong threshold; posting_time pearson_r=0.83 above high-confidence floor"
   */
  rationale: string;
  /** Bookkeeping the predicate aggregation used, for audit. */
  predicates: {
    axes_computed_count: number;
    axes_exceeding_moderate: number;
    axes_exceeding_strong: number;
    has_high_confidence_evidence: boolean;
  };
}

/**
 * The full `axes_evidence` jsonb stored in `actor_cluster_members.axes_evidence`.
 *
 * Operator-review contract: an operator inspecting this object can read every
 * field and explain why the suggested relationship exists, without consulting
 * any other surface. This is the literal answer to operator's most-important
 * question for Slice 2.
 */
export interface AxesEvidenceV1 {
  /** Schema version. Bump only with a documented consumer migration. */
  v: 1;
  /** UTC ISO timestamp when the comparison ran. */
  computed_at: string;
  /** Tenant context the comparison was performed under. Must match both members. */
  tenant_id: string;
  /** Entity A (the "anchor" — typically operator-selected first). */
  entity_a_id: string;
  /** Entity B (the candidate). */
  entity_b_id: string;
  /** Flight Recorder trace id linking this comparison to its retrieval audit. */
  flight_recorder_trace_id: string | null;
  /** Sufficiency-first gate result. */
  sufficiency: SufficiencyResult;
  /** Three per-axis evidence blocks. Always present even when insufficient. */
  axes: {
    posting_time: PostingTimeEvidence;
    vocabulary: VocabularyEvidence;
    source_class: SourceClassEvidence;
  };
  /** Final Cluster Confidence verdict + audit predicates. */
  cluster_confidence: ClusterConfidence;
}

/** Empty per-axis evidence stubs, used to keep the schema fully populated. */
export const EMPTY_POSTING_TIME: PostingTimeEvidence = {
  status: "insufficient_samples",
  stub_reason: "axis not yet computed",
  n_signals_a: 0,
  n_signals_b: 0,
  pearson_r: null,
  most_active_shared_hours: [],
  evidence_summary: "",
  exceeds_moderate: false,
  exceeds_strong: false,
};

export const EMPTY_VOCABULARY: VocabularyEvidence = {
  status: "insufficient_samples",
  stub_reason: "axis not yet computed",
  n_words_a: 0,
  n_words_b: 0,
  top_shared_distinctive_terms: [],
  overlap_ratio: 0,
  evidence_summary: "",
  exceeds_moderate: false,
  exceeds_strong: false,
};

export const EMPTY_SOURCE_CLASS: SourceClassEvidence = {
  status: "insufficient_samples",
  stub_reason: "axis not yet computed",
  classes_a: [],
  classes_b: [],
  shared_classes: [],
  overlap_ratio: 0,
  evidence_summary: "",
  exceeds_moderate: false,
  exceeds_strong: false,
};
