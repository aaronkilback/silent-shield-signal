// =============================================================================
// ER v1 Slice 2 — Source-Class Overlap axis
// =============================================================================
//
// Measures whether two actors share a DISTINCTIVE source footprint — the
// normalized taxonomy already in prod (`aegis-coverage-confidence.ts`).
//
// A′ NON-UBIQUITOUS SHARED-CLASS GUARD (2026-06-02):
//   Sharing ubiquitous publication infrastructure (news, social platforms, rss,
//   blogs, video, local/community news) is NOT identity-corroborating — nearly
//   any entity appears there. Read-only prod evidence: 96% of entities are
//   {news} or {news+social}, so raw class overlap fired moderate/strong for
//   almost every pair — a shared-infrastructure artifact, the same failure mode
//   as the posting-time / monitor-cadence confound (G-9).
//
//   Therefore source-class contributes behavioral corroboration ONLY when the
//   two actors share a class on the DISTINCTIVE allowlist (a specific
//   institutional source, e.g. government / government_cyber). Overlap that is
//   purely on ubiquitous classes is reported for transparency but does NOT
//   exceed any threshold and does NOT count as behavioral corroboration.
//
//   This is fail-closed: the allowlist names what CAN corroborate; everything
//   else — including unknown/future classes — cannot. The objective is
//   trustworthiness, not sensitivity: prevent false MEDIUM/HIGH, never
//   manufacture one from shared news/social coverage.
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
 * Below this, the axis emits insufficient_samples — an actor seen on only one
 * class offers no diversity-based evidence.
 */
export const SOURCE_CLASS_MIN_CLASSES_PER_ACTOR = 2;

/**
 * A′ allowlist: source classes that are DISTINCTIVE enough to count as behavioral
 * corroboration when SHARED. These are specific institutional sources — appearing
 * in a CISA/NVD/KEV cyber bulletin (government_cyber) or a CSIS/RCMP/gov source
 * (government) is a characteristic far more specific than "mentioned in the news"
 * or "posted on social". Everything NOT on this list (news, all social_*, rss,
 * blog, video, community_local, court, wildfire, emergency_alert, unknown) is
 * treated as ubiquitous and cannot corroborate. Operator-tunable (PR + sign-off).
 * 'court' is intentionally EXCLUDED for now: on an energy/activism corpus,
 * litigation/injunction coverage is common (topical), not identity-bearing.
 */
export const SOURCE_CLASS_CORROBORATING_CLASSES: ReadonlySet<string> = new Set([
  "government",
  "government_cyber",
]);

/** ≥ this many SHARED DISTINCTIVE classes → moderate behavioral corroboration. */
export const SOURCE_CLASS_MODERATE_DISTINCTIVE_COUNT = 1;

/** ≥ this many SHARED DISTINCTIVE classes → strong behavioral corroboration. */
export const SOURCE_CLASS_STRONG_DISTINCTIVE_COUNT = 2;

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
      distinctive_shared_classes: [],
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

  // A′ guard: only shared DISTINCTIVE (allowlisted) classes corroborate. Shared
  // ubiquitous classes (news/social/etc.) are reported but do not gate.
  const distinctive_shared = shared.filter((c) => SOURCE_CLASS_CORROBORATING_CLASSES.has(c));
  const ubiquitous_shared = shared.filter((c) => !SOURCE_CLASS_CORROBORATING_CLASSES.has(c));

  const exceeds_moderate = distinctive_shared.length >= SOURCE_CLASS_MODERATE_DISTINCTIVE_COUNT;
  const exceeds_strong = distinctive_shared.length >= SOURCE_CLASS_STRONG_DISTINCTIVE_COUNT;

  let evidence_summary: string;
  if (shared.length === 0) {
    evidence_summary =
      `no shared source classes; A: [${classes_a.join(", ")}]; B: [${classes_b.join(", ")}]`;
  } else if (distinctive_shared.length === 0) {
    // The confound case: overlap exists but only on ubiquitous infrastructure.
    evidence_summary =
      `shared classes [${shared.join(", ")}] are all ubiquitous publication ` +
      `infrastructure (news/social/etc.) — common to most entities, NOT ` +
      `identity-corroborating; source-class contributes no behavioral evidence ` +
      `(overlap_ratio=${overlap_ratio.toFixed(2)} reported for transparency only)`;
  } else {
    evidence_summary =
      `${distinctive_shared.length} shared DISTINCTIVE source class(es) ` +
      `[${distinctive_shared.join(", ")}]` +
      (ubiquitous_shared.length
        ? ` (ubiquitous shared [${ubiquitous_shared.join(", ")}] excluded as common infrastructure)`
        : ``) +
      `; overlap_ratio=${overlap_ratio.toFixed(2)}`;
  }

  return {
    status: "computed",
    stub_reason: null,
    classes_a,
    classes_b,
    shared_classes: shared,
    distinctive_shared_classes: distinctive_shared,
    overlap_ratio,
    evidence_summary,
    exceeds_moderate,
    exceeds_strong,
    has_high_confidence_evidence: false, // source-class alone is never high-confidence
  };
}
