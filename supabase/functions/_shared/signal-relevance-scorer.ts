// ═══════════════════════════════════════════════════════════════════════════════
//                    ADAPTIVE SIGNAL RELEVANCE SCORER v3
// ═══════════════════════════════════════════════════════════════════════════════
// Full adaptive pipeline: learning profiles, source reliability, temporal decay,
// category-specific patterns, adaptive thresholds, embedding similarity,
// source diversity, seasonal patterns, analyst-weighted feedback, and explainability.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ScoreFactor {
  name: string;
  contribution: number; // positive = boost, negative = penalty
  detail: string;
}

export interface RelevanceScore {
  score: number;
  reason: string;
  matchedPatterns: string[];
  recommendation: 'ingest' | 'low_confidence' | 'suppress';
  confidence: number;
  factors: ScoreFactor[]; // Full explainability breakdown
  embeddingSimilarity?: number;
  sourceDiversityCount?: number;
  seasonalMatch?: boolean;
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

function temporalWeight(featureTimestamp: string | null): number {
  if (!featureTimestamp) return 0.5;
  const ageMs = Date.now() - new Date(featureTimestamp).getTime();
  const halfLifeMs = 14 * 24 * 60 * 60 * 1000;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

// ═══ PUBLIC API ═══

export function isTestContent(text: string): boolean {
  return TEST_CONTENT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Score a signal's relevance using the full adaptive pipeline v3
 * Now includes: embedding similarity, source diversity, seasonal patterns,
 * analyst-weighted feedback, and full explainability factors.
 */
export async function scoreSignalRelevance(
  supabase: SupabaseClient,
  signalText: string,
  signalType: string | null,
  severityScore: number | null,
  sourceKey?: string | null,
  options?: {
    signalId?: string;
    userId?: string;
    allSourceKeys?: string[]; // For source diversity calculation
    signalEmbedding?: number[]; // Pre-computed embedding if available
    storeExplanation?: boolean; // Persist the score breakdown
  }
): Promise<RelevanceScore> {
  const factors: ScoreFactor[] = [];
  const matchedPatterns: string[] = [];
  let score = 0.5;
  let confidence = 0.3;
  let embeddingSimilarity: number | undefined;
  let sourceDiversityCount: number | undefined;
  let seasonalMatch = false;

  // ═══ PHASE 1: Static pattern checks ═══
  if (isTestContent(signalText)) {
    return {
      score: 0.0,
      reason: 'Test/verification content detected',
      matchedPatterns: ['test_content'],
      recommendation: 'suppress',
      confidence: 1.0,
      factors: [{ name: 'Test Content', contribution: -1.0, detail: 'Matched test/verification pattern' }],
    };
  }

  const lowValueMatch = LOW_VALUE_PATTERNS.find(p => p.test(signalText));
  if (lowValueMatch) {
    score -= 0.25;
    matchedPatterns.push('low_value_pattern');
    confidence += 0.1;
    factors.push({ name: 'Low-Value Pattern', contribution: -0.25, detail: 'Matched noise pattern (merch, tickets, etc.)' });
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
        const sourceAdjustment = (sourceMetrics.reliability_score - 0.5) * 0.3;
        score += sourceAdjustment;
        confidence += 0.1;
        matchedPatterns.push(`source_reliability:${sourceMetrics.reliability_score}`);
        factors.push({
          name: 'Source Reliability',
          contribution: sourceAdjustment,
          detail: `${sourceKey}: ${sourceMetrics.reliability_score} reliability (${sourceMetrics.accurate_signals}/${sourceMetrics.accurate_signals + sourceMetrics.false_positives} accurate)`
        });
      }
    } catch { /* Source not tracked yet */ }
  }

  // ═══ PHASE 3: Source diversity boosting ═══
  if (options?.allSourceKeys && options.allSourceKeys.length > 1) {
    const uniqueSources = new Set(options.allSourceKeys);
    sourceDiversityCount = uniqueSources.size;
    if (sourceDiversityCount >= 3) {
      const boost = Math.min(0.2, (sourceDiversityCount - 2) * 0.05);
      score += boost;
      confidence += 0.15;
      matchedPatterns.push(`source_diversity:${sourceDiversityCount}`);
      factors.push({
        name: 'Source Diversity',
        contribution: boost,
        detail: `Corroborated by ${sourceDiversityCount} independent sources`
      });
    } else if (sourceDiversityCount === 2) {
      score += 0.05;
      confidence += 0.05;
      factors.push({ name: 'Source Diversity', contribution: 0.05, detail: 'Seen from 2 sources' });
    }
  }

  // ═══ PHASE 4: Embedding similarity scoring ═══
  if (options?.signalEmbedding) {
    try {
      // Find most similar approved and rejected signals via pgvector
      const embeddingStr = JSON.stringify(options.signalEmbedding);

      const [{ data: approvedMatch }, { data: rejectedMatch }] = await Promise.all([
        supabase.rpc('match_approved_signals', {
          query_embedding: embeddingStr,
          match_threshold: 0.6,
          match_count: 3
        }),
        supabase.rpc('match_rejected_signals', {
          query_embedding: embeddingStr,
          match_threshold: 0.6,
          match_count: 3
        })
      ]);

      const maxApprovedSim = approvedMatch?.[0]?.similarity || 0;
      const maxRejectedSim = rejectedMatch?.[0]?.similarity || 0;
      embeddingSimilarity = maxApprovedSim;

      if (maxApprovedSim > 0.75 && maxApprovedSim > maxRejectedSim) {
        const boost = (maxApprovedSim - 0.75) * 0.8; // Up to +0.2
        score += boost;
        confidence += 0.2;
        matchedPatterns.push(`embedding_approved:${maxApprovedSim.toFixed(3)}`);
        factors.push({
          name: 'Embedding Similarity (Approved)',
          contribution: boost,
          detail: `${(maxApprovedSim * 100).toFixed(0)}% similar to approved signals`
        });
      } else if (maxRejectedSim > 0.75 && maxRejectedSim > maxApprovedSim) {
        const penalty = (maxRejectedSim - 0.75) * -0.8;
        score += penalty;
        confidence += 0.2;
        matchedPatterns.push(`embedding_rejected:${maxRejectedSim.toFixed(3)}`);
        factors.push({
          name: 'Embedding Similarity (Rejected)',
          contribution: penalty,
          detail: `${(maxRejectedSim * 100).toFixed(0)}% similar to rejected signals`
        });
      }
    } catch (err) {
      console.error('[RelevanceScorer] Embedding similarity error:', err);
      // Graceful fallback — continue without embedding scoring
    }
  }

  // ═══ PHASE 5: Learning profile matching with temporal decay ═══
  try {
    const { data: profiles } = await supabase
      .from('learning_profiles')
      .select('profile_type, features, sample_count, last_updated')
      .in('profile_type', [
        'rejected_signal_patterns',
        'approved_signal_patterns',
        'adaptive_thresholds',
        'seasonal_patterns',
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
          const penalty = -0.25 * decay;
          score += penalty;
          matchedPatterns.push(`rejected_match:${rejectedHits}/${words.length}(decay:${decay.toFixed(2)})`);
          confidence += 0.15;
          factors.push({ name: 'Rejected Patterns', contribution: penalty, detail: `${rejectedHits}/${words.length} words match rejected profiles (decay: ${decay.toFixed(2)})` });
        } else if (rejectedRatio > 0.15) {
          const penalty = -0.1 * decay;
          score += penalty;
          matchedPatterns.push(`partial_rejected:${rejectedHits}/${words.length}`);
          confidence += 0.05;
          factors.push({ name: 'Partial Rejected', contribution: penalty, detail: `${rejectedHits}/${words.length} words weakly match rejected profiles` });
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
          const boost = 0.2 * decay;
          score += boost;
          matchedPatterns.push(`approved_match:${approvedHits}/${words.length}(decay:${decay.toFixed(2)})`);
          confidence += 0.15;
          factors.push({ name: 'Approved Patterns', contribution: boost, detail: `${approvedHits}/${words.length} words match approved profiles (decay: ${decay.toFixed(2)})` });
        }
      }

      // --- Category-specific patterns ---
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
            const boost = 0.15 * decay;
            score += boost;
            matchedPatterns.push(`cat_approved:${signalType}:${catApprovedHits}`);
            confidence += 0.1;
            factors.push({ name: `Category: ${signalType}`, contribution: boost, detail: `${catApprovedHits} category-approved words matched` });
          }
        }

        if (catFeatures.rejected_features && catFeatures.rejected_count > 2) {
          let catRejectedHits = 0;
          for (const word of words) {
            if (catFeatures.rejected_features[word]) catRejectedHits++;
          }
          const catRatio = words.length > 0 ? catRejectedHits / words.length : 0;
          if (catRatio > 0.2) {
            const penalty = -0.15 * decay;
            score += penalty;
            matchedPatterns.push(`cat_rejected:${signalType}:${catRejectedHits}`);
            confidence += 0.1;
            factors.push({ name: `Category Rejected: ${signalType}`, contribution: penalty, detail: `${catRejectedHits} category-rejected words matched` });
          }
        }
      }

      // --- Seasonal patterns ---
      const seasonalProfile = profiles.find(p => p.profile_type === 'seasonal_patterns');
      if (seasonalProfile?.features) {
        const seasonal = seasonalProfile.features as any;
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentDow = now.getDay();

        // Check monthly spikes
        if (seasonal.monthly_spikes?.[signalType || 'unknown']) {
          const spikePct = seasonal.monthly_spikes[signalType][currentMonth];
          if (spikePct && spikePct > 1.5) {
            const boost = Math.min(0.1, (spikePct - 1.0) * 0.05);
            score += boost;
            seasonalMatch = true;
            matchedPatterns.push(`seasonal_spike:${signalType}:month_${currentMonth}`);
            factors.push({ name: 'Seasonal Pattern', contribution: boost, detail: `${signalType} historically ${(spikePct * 100).toFixed(0)}% higher this month` });
          }
        }

        // Check day-of-week patterns
        if (seasonal.dow_patterns?.[signalType || 'unknown']) {
          const dowPct = seasonal.dow_patterns[signalType][currentDow];
          if (dowPct && dowPct > 1.5) {
            score += 0.05;
            seasonalMatch = true;
            factors.push({ name: 'Day-of-Week Pattern', contribution: 0.05, detail: `${signalType} activity peaks on this day` });
          }
        }
      }

      // --- Adaptive thresholds loaded ---
      const thresholdsProfile = profiles.find(p => p.profile_type === 'adaptive_thresholds');
      if (thresholdsProfile?.features) {
        const thresholds = thresholdsProfile.features as unknown as AdaptiveThresholds;
        matchedPatterns.push(`adaptive_thresholds:${thresholds.suppress_below}/${thresholds.low_confidence_below}`);
      }
    }
  } catch (err) {
    console.error('[RelevanceScorer] Profile load error:', err);
  }

  // ═══ PHASE 6: Severity-based adjustments ═══
  if (severityScore !== null && severityScore <= 20) {
    if (signalType === 'community_impact' || signalType === 'reputational') {
      score -= 0.1;
      matchedPatterns.push('low_severity_social');
      factors.push({ name: 'Low Severity', contribution: -0.1, detail: `Severity ${severityScore} for ${signalType}` });
    }
  }
  if (severityScore !== null && severityScore >= 80) {
    score += 0.1;
    matchedPatterns.push('high_severity_boost');
    factors.push({ name: 'High Severity', contribution: 0.1, detail: `Severity ${severityScore} indicates urgency` });
  }

  // ═══ PHASE 7: Determine recommendation ═══
  score = Math.max(0.0, Math.min(1.0, score));
  confidence = Math.max(0.0, Math.min(1.0, confidence));

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

  // ═══ PHASE 8: Persist explanation for UI ═══
  if (options?.storeExplanation && options?.signalId) {
    try {
      await supabase.from('signal_score_explanations').upsert({
        signal_id: options.signalId,
        total_score: score,
        confidence,
        recommendation,
        factors: factors,
        embedding_similarity: embeddingSimilarity || null,
        source_diversity_count: sourceDiversityCount || 0,
        source_diversity_boost: factors.find(f => f.name === 'Source Diversity')?.contribution || 0,
        seasonal_pattern_match: seasonalMatch,
        seasonal_detail: factors.find(f => f.name === 'Seasonal Pattern')?.detail || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'signal_id' });
    } catch (err) {
      console.error('[RelevanceScorer] Failed to store explanation:', err);
    }
  }

  return { score, reason, matchedPatterns, recommendation, confidence, factors, embeddingSimilarity, sourceDiversityCount, seasonalMatch };
}
