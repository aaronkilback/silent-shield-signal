// ═══════════════════════════════════════════════════════════════════════════════
//                    ADAPTIVE SIGNAL RELEVANCE SCORER v2
// ═══════════════════════════════════════════════════════════════════════════════
// Uses learning profiles, source reliability, temporal decay, category-specific
// patterns, adaptive thresholds, and embedding similarity for intelligent filtering.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RelevanceScore {
  score: number; // 0.0 to 1.0
  reason: string;
  matchedPatterns: string[];
  recommendation: 'ingest' | 'low_confidence' | 'suppress';
  confidence: number; // How confident the scorer is in its own assessment
}

interface AdaptiveThresholds {
  suppress_below: number;
  low_confidence_below: number;
  feedback_ratio: number;
  last_calibrated: string;
}

interface CategoryProfile {
  approved_features: Record<string, number>;
  rejected_features: Record<string, number>;
  approved_count: number;
  rejected_count: number;
}

// ═══ STATIC PATTERNS ═══

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

const LOW_VALUE_PATTERNS = [
  /\b(hoodie|sweater|merch)\s+order\b/i,
  /\bconcert\s+tickets?\b/i,
  /\balbum\s+(release|drop)\b/i,
  /\bcustomer\s+preference\s+for\b/i,
  /\bski\s+resort\b/i,
  /\brecipe\s+for\b/i,
  /\bfashion\s+(show|week)\b/i,
];

// ═══ TEMPORAL DECAY ═══
// Half-life of 14 days — feedback from 2 weeks ago has half the weight

function temporalWeight(featureTimestamp: string | null): number {
  if (!featureTimestamp) return 0.5;
  const ageMs = Date.now() - new Date(featureTimestamp).getTime();
  const halfLifeMs = 14 * 24 * 60 * 60 * 1000; // 14 days
  return Math.pow(0.5, ageMs / halfLifeMs);
}

// ═══ PUBLIC API ═══

export function isTestContent(text: string): boolean {
  return TEST_CONTENT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Score a signal's relevance using the full adaptive pipeline
 */
export async function scoreSignalRelevance(
  supabase: SupabaseClient,
  signalText: string,
  signalType: string | null,
  severityScore: number | null,
  sourceKey?: string | null
): Promise<RelevanceScore> {
  const matchedPatterns: string[] = [];
  let score = 0.5; // Neutral baseline (shifted from 0.7 for better discrimination)
  let confidence = 0.3; // Low confidence with no data

  // ═══ PHASE 1: Static pattern checks ═══
  if (isTestContent(signalText)) {
    return {
      score: 0.0,
      reason: 'Test/verification content detected',
      matchedPatterns: ['test_content'],
      recommendation: 'suppress',
      confidence: 1.0
    };
  }

  const lowValueMatch = LOW_VALUE_PATTERNS.find(p => p.test(signalText));
  if (lowValueMatch) {
    score -= 0.25;
    matchedPatterns.push('low_value_pattern');
    confidence += 0.1;
  }

  // ═══ PHASE 2: Source reliability weighting ═══
  if (sourceKey) {
    try {
      const { data: sourceMetrics } = await supabase
        .from('source_reliability_metrics')
        .select('reliability_score, total_signals, accurate_signals, false_positives')
        .eq('source_name', sourceKey)
        .single();

      if (sourceMetrics && (sourceMetrics.accurate_signals + sourceMetrics.false_positives) > 2) {
        // Shift baseline based on source track record
        const sourceAdjustment = (sourceMetrics.reliability_score - 0.5) * 0.3;
        score += sourceAdjustment;
        confidence += 0.1;
        matchedPatterns.push(`source_reliability:${sourceMetrics.reliability_score}`);
      }
    } catch { /* Source not tracked yet — use baseline */ }
  }

  // ═══ PHASE 3: Learning profile matching with temporal decay ═══
  try {
    const { data: profiles } = await supabase
      .from('learning_profiles')
      .select('profile_type, features, sample_count, last_updated')
      .in('profile_type', [
        'rejected_signal_patterns',
        'approved_signal_patterns',
        'adaptive_thresholds',
        `category:${signalType || 'unknown'}`
      ]);

    if (profiles && profiles.length > 0) {
      const textLower = signalText.toLowerCase();
      const words = textLower.split(/\s+/).filter(w => w.length > 3);

      // --- Global rejected patterns ---
      const rejectedProfile = profiles.find(p => p.profile_type === 'rejected_signal_patterns');
      if (rejectedProfile?.features && rejectedProfile.sample_count > 2) {
        const decay = temporalWeight(rejectedProfile.last_updated);
        const rejectedFeatures = rejectedProfile.features as Record<string, number>;
        let rejectedHits = 0;

        for (const word of words) {
          if (rejectedFeatures[word]) rejectedHits++;
        }

        const rejectedRatio = words.length > 0 ? rejectedHits / words.length : 0;
        if (rejectedRatio > 0.3) {
          score -= 0.25 * decay;
          matchedPatterns.push(`rejected_match:${rejectedHits}/${words.length}(decay:${decay.toFixed(2)})`);
          confidence += 0.15;
        } else if (rejectedRatio > 0.15) {
          score -= 0.1 * decay;
          matchedPatterns.push(`partial_rejected:${rejectedHits}/${words.length}`);
          confidence += 0.05;
        }
      }

      // --- Global approved patterns ---
      const approvedProfile = profiles.find(p => p.profile_type === 'approved_signal_patterns');
      if (approvedProfile?.features && approvedProfile.sample_count > 2) {
        const decay = temporalWeight(approvedProfile.last_updated);
        const approvedFeatures = approvedProfile.features as Record<string, number>;
        let approvedHits = 0;

        for (const word of words) {
          if (approvedFeatures[word]) approvedHits++;
        }

        const approvedRatio = words.length > 0 ? approvedHits / words.length : 0;
        if (approvedRatio > 0.2) {
          score += 0.2 * decay;
          matchedPatterns.push(`approved_match:${approvedHits}/${words.length}(decay:${decay.toFixed(2)})`);
          confidence += 0.15;
        }
      }

      // --- Category-specific patterns (Tier 2) ---
      const categoryProfile = profiles.find(p => p.profile_type === `category:${signalType || 'unknown'}`);
      if (categoryProfile?.features) {
        const catFeatures = categoryProfile.features as CategoryProfile;
        const decay = temporalWeight(categoryProfile.last_updated);

        if (catFeatures.approved_features && catFeatures.approved_count > 2) {
          let catApprovedHits = 0;
          for (const word of words) {
            if (catFeatures.approved_features[word]) catApprovedHits++;
          }
          const catRatio = words.length > 0 ? catApprovedHits / words.length : 0;
          if (catRatio > 0.15) {
            score += 0.15 * decay;
            matchedPatterns.push(`cat_approved:${signalType}:${catApprovedHits}`);
            confidence += 0.1;
          }
        }

        if (catFeatures.rejected_features && catFeatures.rejected_count > 2) {
          let catRejectedHits = 0;
          for (const word of words) {
            if (catFeatures.rejected_features[word]) catRejectedHits++;
          }
          const catRatio = words.length > 0 ? catRejectedHits / words.length : 0;
          if (catRatio > 0.2) {
            score -= 0.15 * decay;
            matchedPatterns.push(`cat_rejected:${signalType}:${catRejectedHits}`);
            confidence += 0.1;
          }
        }
      }

      // --- Adaptive thresholds (Tier 1) ---
      const thresholdsProfile = profiles.find(p => p.profile_type === 'adaptive_thresholds');
      if (thresholdsProfile?.features) {
        const thresholds = thresholdsProfile.features as unknown as AdaptiveThresholds;
        // We'll use these below when determining recommendation
        matchedPatterns.push(`adaptive_thresholds:${thresholds.suppress_below}/${thresholds.low_confidence_below}`);
      }
    }
  } catch (err) {
    console.error('[RelevanceScorer] Profile load error:', err);
  }

  // ═══ PHASE 4: Severity-based adjustments ═══
  if (severityScore !== null && severityScore <= 20) {
    if (signalType === 'community_impact' || signalType === 'reputational') {
      score -= 0.1;
      matchedPatterns.push('low_severity_social');
    }
  }

  // High severity gets a small boost
  if (severityScore !== null && severityScore >= 80) {
    score += 0.1;
    matchedPatterns.push('high_severity_boost');
  }

  // ═══ PHASE 5: Determine recommendation using adaptive thresholds ═══
  score = Math.max(0.0, Math.min(1.0, score));
  confidence = Math.max(0.0, Math.min(1.0, confidence));

  // Load adaptive thresholds or use defaults
  let suppressBelow = 0.25;
  let lowConfBelow = 0.45;

  try {
    const { data: thresholdProfile } = await supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'adaptive_thresholds')
      .single();

    if (thresholdProfile?.features) {
      const t = thresholdProfile.features as unknown as AdaptiveThresholds;
      suppressBelow = t.suppress_below;
      lowConfBelow = t.low_confidence_below;
    }
  } catch { /* Use defaults */ }

  let recommendation: 'ingest' | 'low_confidence' | 'suppress';
  let reason: string;

  if (score < suppressBelow) {
    recommendation = 'suppress';
    reason = `Below adaptive threshold (${suppressBelow}) — matches noise patterns`;
  } else if (score < lowConfBelow) {
    recommendation = 'low_confidence';
    reason = `Below confidence threshold (${lowConfBelow}) — tagged for review`;
  } else {
    recommendation = 'ingest';
    reason = `Meets adaptive threshold (${lowConfBelow})`;
  }

  return { score, reason, matchedPatterns, recommendation, confidence };
}
