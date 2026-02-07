// Signal Relevance Scorer - Uses learning profiles to pre-filter noise
// Leverages accumulated feedback patterns to score incoming signals

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RelevanceScore {
  score: number; // 0.0 to 1.0
  reason: string;
  matchedPatterns: string[];
  recommendation: 'ingest' | 'low_confidence' | 'suppress';
}

// Test content patterns that should never be stored as real signals
const TEST_CONTENT_PATTERNS = [
  /test\s+document\s+content\s+for\s+[\w-]+\s+function\s+verification/i,
  /^test[\s-]ping/i,
  /^this\s+is\s+a\s+test\s+signal/i,
  /^\[test\]\s/i,
  /^test\s+data\s*[:.-]/i,
  /pipeline\s+test\s+signal/i,
  /verification\s+test\s+content/i,
  /health[_\s]?check\s+test/i,
];

// Low-value social media patterns (e.g., personal posts, commerce, entertainment)
const LOW_VALUE_PATTERNS = [
  /\b(hoodie|sweater|merch)\s+order\b/i,
  /\bconcert\s+tickets?\b/i,
  /\balbum\s+(release|drop)\b/i,
  /\bcustomer\s+preference\s+for\b/i,
  /\bski\s+resort\b/i,
  /\brecipe\s+for\b/i,
  /\bfashion\s+(show|week)\b/i,
];

/**
 * Check if content is test/verification data that should be rejected
 */
export function isTestContent(text: string): boolean {
  return TEST_CONTENT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Score a signal's relevance using learned patterns from feedback
 */
export async function scoreSignalRelevance(
  supabase: SupabaseClient,
  signalText: string,
  signalType: string | null,
  severityScore: number | null
): Promise<RelevanceScore> {
  const matchedPatterns: string[] = [];
  let score = 0.7; // Default baseline

  // Step 1: Reject test content immediately
  if (isTestContent(signalText)) {
    return {
      score: 0.0,
      reason: 'Test/verification content detected',
      matchedPatterns: ['test_content'],
      recommendation: 'suppress'
    };
  }

  // Step 2: Check low-value patterns
  const lowValueMatch = LOW_VALUE_PATTERNS.find(p => p.test(signalText));
  if (lowValueMatch) {
    score -= 0.3;
    matchedPatterns.push('low_value_pattern');
  }

  // Step 3: Load learning profiles
  try {
    const { data: profiles } = await supabase
      .from('learning_profiles')
      .select('profile_type, features, sample_count')
      .in('profile_type', ['rejected_signal_patterns', 'approved_signal_patterns']);

    if (profiles && profiles.length > 0) {
      const rejectedProfile = profiles.find(p => p.profile_type === 'rejected_signal_patterns');
      const approvedProfile = profiles.find(p => p.profile_type === 'approved_signal_patterns');

      const textLower = signalText.toLowerCase();
      const words = textLower.split(/\s+/).filter(w => w.length > 3);

      // Score against rejected patterns
      if (rejectedProfile?.features && rejectedProfile.sample_count > 3) {
        const rejectedFeatures = rejectedProfile.features as Record<string, number>;
        let rejectedHits = 0;
        let rejectedWeight = 0;

        for (const word of words) {
          if (rejectedFeatures[word]) {
            rejectedHits++;
            rejectedWeight += rejectedFeatures[word];
          }
        }

        // If many words match rejected patterns, lower score
        const rejectedRatio = words.length > 0 ? rejectedHits / words.length : 0;
        if (rejectedRatio > 0.3) {
          score -= 0.25;
          matchedPatterns.push(`rejected_pattern_match:${rejectedHits}/${words.length}`);
        } else if (rejectedRatio > 0.15) {
          score -= 0.1;
          matchedPatterns.push(`partial_rejected_match:${rejectedHits}/${words.length}`);
        }
      }

      // Score against approved patterns (boost)
      if (approvedProfile?.features && approvedProfile.sample_count > 3) {
        const approvedFeatures = approvedProfile.features as Record<string, number>;
        let approvedHits = 0;

        for (const word of words) {
          if (approvedFeatures[word]) {
            approvedHits++;
          }
        }

        const approvedRatio = words.length > 0 ? approvedHits / words.length : 0;
        if (approvedRatio > 0.2) {
          score += 0.15;
          matchedPatterns.push(`approved_pattern_match:${approvedHits}/${words.length}`);
        }
      }
    }
  } catch (err) {
    console.error('[RelevanceScorer] Error loading learning profiles:', err);
    // Continue with baseline score
  }

  // Step 4: Apply severity-based adjustments
  if (severityScore !== null && severityScore <= 20) {
    // Very low severity social media signals get penalized
    if (signalType === 'community_impact' || signalType === 'reputational') {
      score -= 0.15;
      matchedPatterns.push('low_severity_social');
    }
  }

  // Clamp score
  score = Math.max(0.0, Math.min(1.0, score));

  // Determine recommendation
  let recommendation: 'ingest' | 'low_confidence' | 'suppress';
  let reason: string;

  if (score < 0.25) {
    recommendation = 'suppress';
    reason = 'Below relevance threshold - matches known noise patterns';
  } else if (score < 0.45) {
    recommendation = 'low_confidence';
    reason = 'Low confidence - tagged for review but not promoted to main feed';
  } else {
    recommendation = 'ingest';
    reason = 'Meets relevance threshold';
  }

  return { score, reason, matchedPatterns, recommendation };
}
