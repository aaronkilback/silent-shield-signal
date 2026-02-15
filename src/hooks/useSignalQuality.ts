import { useMemo } from "react";

/**
 * Signal quality utilities.
 * Provides quality tier classification and display helpers
 * for signals with quality_score and feedback_score columns.
 */

export type QualityTier = 'high' | 'medium' | 'low' | 'unscored';

export interface QualityInfo {
  tier: QualityTier;
  label: string;
  color: string;
  tooltip: string;
}

/**
 * Classify a signal's quality tier based on its quality_score.
 */
export function getQualityTier(qualityScore: number | null | undefined): QualityTier {
  if (qualityScore == null) return 'unscored';
  if (qualityScore >= 0.7) return 'high';
  if (qualityScore >= 0.4) return 'medium';
  return 'low';
}

/**
 * Get display info for a quality tier.
 */
export function getQualityInfo(qualityScore: number | null | undefined): QualityInfo {
  const tier = getQualityTier(qualityScore);
  switch (tier) {
    case 'high':
      return {
        tier,
        label: 'High Quality',
        color: 'text-green-500',
        tooltip: 'Source URL, entities, location, and metadata all present',
      };
    case 'medium':
      return {
        tier,
        label: 'Adequate',
        color: 'text-yellow-500',
        tooltip: 'Some metadata missing — limited verifiability',
      };
    case 'low':
      return {
        tier,
        label: 'Low Quality',
        color: 'text-red-500',
        tooltip: 'Missing source URL, entities, or substantive content',
      };
    case 'unscored':
      return {
        tier,
        label: 'Unscored',
        color: 'text-muted-foreground',
        tooltip: 'Quality not yet assessed',
      };
  }
}

/**
 * Get feedback interpretation for display.
 */
export function getFeedbackInfo(feedbackScore: number | null | undefined): {
  label: string;
  color: string;
  tooltip: string;
} {
  if (feedbackScore == null || feedbackScore === 0.5) {
    return { label: 'No feedback', color: 'text-muted-foreground', tooltip: 'No analyst interactions recorded' };
  }
  if (feedbackScore >= 0.7) {
    return { label: 'Analyst-validated', color: 'text-green-500', tooltip: 'Analysts spent time reviewing and/or escalated this signal' };
  }
  if (feedbackScore >= 0.4) {
    return { label: 'Neutral', color: 'text-muted-foreground', tooltip: 'Mixed analyst interactions' };
  }
  return { label: 'Low engagement', color: 'text-orange-500', tooltip: 'Analysts quickly dismissed this signal' };
}

/**
 * Compute a combined relevance score from quality + feedback + explicit relevance.
 * Used for sorting signals by overall information value.
 */
export function computeCompositeScore(
  qualityScore: number | null | undefined,
  feedbackScore: number | null | undefined,
  relevanceScore: number | null | undefined,
): number {
  const q = qualityScore ?? 0.5;
  const f = feedbackScore ?? 0.5;
  const r = relevanceScore ?? 0.5;
  // Weighted: 40% quality, 30% feedback, 30% relevance
  return q * 0.4 + f * 0.3 + r * 0.3;
}

/**
 * Hook that provides quality utilities as a memoized object.
 */
export const useSignalQuality = () => {
  return useMemo(() => ({
    getQualityTier,
    getQualityInfo,
    getFeedbackInfo,
    computeCompositeScore,
  }), []);
};
