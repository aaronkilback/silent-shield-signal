// =============================================================================
// ER v1 Slice 2 — Source-Class Overlap axis
// =============================================================================
//
// Measures whether two actors appear on the same set of source classes — the
// normalized taxonomy already in prod (`aegis-coverage-confidence.ts`).
//
// Why this axis matters: cross-platform reach is corroborative. Two actors
// posting only to a single dominant platform (e.g., both "news") is a weak
// signal — the axis stubs out below `SOURCE_CLASS_MIN_CLASSES_PER_ACTOR`.
//
// Pure function given inputs. Caller is responsible for deduping + tenant-
// scoping the source labels passed in.

import type { SourceClassEvidence } from "./_evidence-schema.ts";
import { normalizeSourceClass } from "../aegis-coverage-confidence.ts";

// ─────────────────────────────────────────────────────────────────────────────
// §A — Operator-tunable thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum DISTINCT source classes per actor for this axis to be meaningful.
 * Below this, the axis emits insufficient_samples — an actor posting to only
 * one platform offers no diversity-based evidence.
 */
export const SOURCE_CLASS_MIN_CLASSES_PER_ACTOR = 2;

/** Overlap ratio ≥ this AND ≥1 shared class → moderate threshold. */
export const SOURCE_CLASS_MODERATE_OVERLAP = 0.2;

/** Overlap ratio ≥ this AND ≥2 shared classes → strong threshold. */
export const SOURCE_CLASS_STRONG_OVERLAP = 0.5;
export const SOURCE_CLASS_STRONG_SHARED_COUNT = 2;

// ─────────────────────────────────────────────────────────────────────────────
// §B — Main axis function
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceClassInput {
  /** Raw source labels seen for entity A (one per signal; deduplication is internal). */
  sourceLabelsA: readonly string[];
  /** Raw source labels seen for entity B. */
  sourceLabelsB: readonly string[];
}

/** Normalize + dedupe, returning a sorted-for-determinism string array. */
function classifyAndDedupe(labels: readonly string[]): string[] {
  const set = new Set<string>();
  for (const l of labels) {
    const cls = normalizeSourceClass(l);
    if (cls && cls !== "unknown_source") set.add(cls);
  }
  return Array.from(set).sort();
}

export function computeSourceClassAxis(input: SourceClassInput): SourceClassEvidence {
  const classes_a = classifyAndDedupe(input.sourceLabelsA);
  const classes_b = classifyAndDedupe(input.sourceLabelsB);

  if (
    classes_a.length < SOURCE_CLASS_MIN_CLASSES_PER_ACTOR ||
    classes_b.length < SOURCE_CLASS_MIN_CLASSES_PER_ACTOR
  ) {
    return {
      status: "insufficient_samples",
      stub_reason:
        `source-class axis needs ≥${SOURCE_CLASS_MIN_CLASSES_PER_ACTOR} distinct classes per actor; ` +
        `entity A has ${classes_a.length}, entity B has ${classes_b.length}`,
      classes_a,
      classes_b,
      shared_classes: [],
      overlap_ratio: 0,
      evidence_summary: "",
      exceeds_moderate: false,
      exceeds_strong: false,
      has_high_confidence_evidence: false,
    };
  }

  const setB = new Set(classes_b);
  const shared = classes_a.filter((c) => setB.has(c));
  const unionSize = new Set([...classes_a, ...classes_b]).size;
  const overlap_ratio = unionSize === 0 ? 0 : shared.length / unionSize;

  const exceeds_moderate =
    shared.length >= 1 && overlap_ratio >= SOURCE_CLASS_MODERATE_OVERLAP;
  const exceeds_strong =
    shared.length >= SOURCE_CLASS_STRONG_SHARED_COUNT &&
    overlap_ratio >= SOURCE_CLASS_STRONG_OVERLAP;

  const evidence_summary = shared.length === 0
    ? `no shared source classes; A: [${classes_a.join(", ")}]; B: [${classes_b.join(", ")}]`
    : `${shared.length} shared source classes (${shared.join(", ")}); ` +
      `overlap_ratio=${overlap_ratio.toFixed(2)}`;

  return {
    status: "computed",
    stub_reason: null,
    classes_a,
    classes_b,
    shared_classes: shared,
    overlap_ratio,
    evidence_summary,
    exceeds_moderate,
    exceeds_strong,
    has_high_confidence_evidence: false, // source-class alone is never high-confidence
  };
}
