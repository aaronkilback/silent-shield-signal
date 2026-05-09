/**
 * Shared helpers for the [0, 1] probability/confidence columns on
 * the signals table.
 *
 * Why this exists: until May 2026 each monitor / writer normalized
 * scores in its own way (sometimes 0-1, sometimes 0-100, sometimes
 * unbounded). monitor-community-outreach was writing the keyword
 * scorer's 0-100 result into signals.confidence — a column shared
 * with the AI classifier's 0-1 output. The collision made wildfire
 * signals render as "1%" while junk pages rendered as "65%" in the
 * UI, with the operator only catching it weeks in.
 *
 * Use these helpers when computing or normalizing values destined
 * for: signals.confidence, signals.relevance_score,
 * signals.composite_confidence, signals.correlation_confidence,
 * signals.quality_score, signals.feedback_score. The database CHECK
 * constraints enforce the [0, 1] invariant at the boundary, but
 * surfacing intent in code makes review-time bugs more visible than
 * waiting for a runtime constraint violation.
 */

/**
 * Clamp any numeric input to the [0, 1] probability range.
 *
 * Behavior:
 *   - null / undefined / NaN → null (preserves "unknown" semantics)
 *   - finite value > 1       → divides by 100 only when input is in
 *                              the [1, 100] range (legacy keyword
 *                              scores) and clamps; values > 100 are
 *                              clamped to 1 directly.
 *   - finite value < 0       → 0
 *   - 0 ≤ value ≤ 1          → unchanged
 *
 * The dual interpretation of [1, 100] handles the legacy
 * monitor-community-outreach case explicitly. New code should never
 * pass values > 1 — when it does, the database constraint will
 * still reject the write, but the helper at least gives consistent
 * client-side behavior.
 */
export function toProbability(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return 1;
}

/**
 * Build a composite_confidence from the three independent inputs.
 * Mirrors the formula in ai-decision-engine/index.ts:614 — keeping
 * one canonical implementation here means future agents (Tier 3,
 * etc.) can reuse it without re-deriving the weights.
 *
 * Weights (sum to 1.0):
 *   ai_confidence     × 0.50  — classifier's read on category/severity
 *   relevance_score   × 0.35  — client-fit scorer
 *   source_credibility× 0.15  — historical trust of the source
 *
 * All inputs accepted on either 0-1 or 0-100 scale (passed through
 * toProbability). null inputs default to 0 — which is intentional;
 * it represents "no signal in this dimension" rather than "unknown".
 */
export function computeComposite(parts: {
  ai_confidence?: number | null;
  relevance_score?: number | null;
  source_credibility?: number | null;
}): number {
  const ai = toProbability(parts.ai_confidence) ?? 0;
  const rel = toProbability(parts.relevance_score) ?? 0;
  const src = toProbability(parts.source_credibility) ?? 0;
  const composite = ai * 0.50 + rel * 0.35 + src * 0.15;
  // Round to 3 decimals to match the on-disk representation in
  // ai-decision-engine and keep diffs stable.
  return Math.round(composite * 1000) / 1000;
}

/**
 * Render a probability as a percentage string for UI / log output.
 * Returns "—" for null inputs so display code can treat it as a
 * single source of truth for "no value present".
 */
export function probabilityToPercentString(value: number | null | undefined): string {
  const p = toProbability(value);
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}
