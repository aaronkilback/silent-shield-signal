import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    console.log('[Learning] ═══ Starting full adaptive learning cycle ═══');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Gather all feedback data
    // ═══════════════════════════════════════════════════════════════

    const [
      { data: signalFeedback },
      { data: approvedSuggestions },
      { data: incidentOutcomes },
      { data: allSignals }
    ] = await Promise.all([
      supabase.from('feedback_events').select('object_id, feedback, created_at')
        .eq('object_type', 'signal').order('created_at', { ascending: false }).limit(500),
      supabase.from('entity_suggestions').select('suggested_name, suggested_type, context, confidence, source_type, status')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('incident_outcomes').select('incident_id, false_positive, was_accurate').limit(200),
      supabase.from('signals').select('id, normalized_text, category, severity, relevance_score, raw_json, created_at')
        .order('created_at', { ascending: false }).limit(1000)
    ]);

    const feedbackMap = new Map<string, { feedback: string; created_at: string }>();
    for (const fb of (signalFeedback || [])) {
      feedbackMap.set(fb.object_id, { feedback: fb.feedback, created_at: fb.created_at });
    }

    // Partition signals by feedback
    const relevantSignals = (allSignals || []).filter(s => feedbackMap.get(s.id)?.feedback === 'relevant');
    const irrelevantSignals = (allSignals || []).filter(s => feedbackMap.get(s.id)?.feedback === 'irrelevant');

    console.log(`[Learning] Data: ${allSignals?.length || 0} signals, ${relevantSignals.length} relevant, ${irrelevantSignals.length} irrelevant`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Build global learning profiles with temporal decay
    // ═══════════════════════════════════════════════════════════════

    const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

    function buildWeightedFeatures(signals: any[]): Record<string, number> {
      const features: Record<string, number> = {};
      for (const sig of signals) {
        const fb = feedbackMap.get(sig.id);
        const ageMs = fb ? Date.now() - new Date(fb.created_at).getTime() : HALF_LIFE_MS;
        const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
        const words = (sig.normalized_text || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        for (const word of words) {
          features[word] = (features[word] || 0) + decay;
        }
      }
      return features;
    }

    const approvedFeatures = buildWeightedFeatures(relevantSignals);
    const rejectedFeatures = buildWeightedFeatures(irrelevantSignals);

    // Upsert global profiles
    const profileUpserts: Promise<any>[] = [];

    if (Object.keys(approvedFeatures).length > 0) {
      profileUpserts.push(supabase.from('learning_profiles').upsert({
        profile_type: 'approved_signal_patterns',
        features: approvedFeatures,
        sample_count: relevantSignals.length,
        last_updated: new Date().toISOString(),
        weight: 1.0
      }, { onConflict: 'profile_type' }));
    }

    if (Object.keys(rejectedFeatures).length > 0) {
      profileUpserts.push(supabase.from('learning_profiles').upsert({
        profile_type: 'rejected_signal_patterns',
        features: rejectedFeatures,
        sample_count: irrelevantSignals.length,
        last_updated: new Date().toISOString(),
        weight: 1.0
      }, { onConflict: 'profile_type' }));
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Category-specific profiles (Tier 2)
    // ═══════════════════════════════════════════════════════════════

    const categoryData = new Map<string, { approved: any[]; rejected: any[] }>();
    for (const sig of relevantSignals) {
      const cat = sig.category || 'unknown';
      if (!categoryData.has(cat)) categoryData.set(cat, { approved: [], rejected: [] });
      categoryData.get(cat)!.approved.push(sig);
    }
    for (const sig of irrelevantSignals) {
      const cat = sig.category || 'unknown';
      if (!categoryData.has(cat)) categoryData.set(cat, { approved: [], rejected: [] });
      categoryData.get(cat)!.rejected.push(sig);
    }

    for (const [category, data] of categoryData.entries()) {
      if (data.approved.length + data.rejected.length < 2) continue;

      const catProfile = {
        approved_features: buildWeightedFeatures(data.approved),
        rejected_features: buildWeightedFeatures(data.rejected),
        approved_count: data.approved.length,
        rejected_count: data.rejected.length
      };

      profileUpserts.push(supabase.from('learning_profiles').upsert({
        profile_type: `category:${category}`,
        features: catProfile,
        sample_count: data.approved.length + data.rejected.length,
        last_updated: new Date().toISOString(),
        weight: 1.0
      }, { onConflict: 'profile_type' }));
    }

    await Promise.all(profileUpserts);
    console.log(`[Learning] Updated ${profileUpserts.length} profiles (${categoryData.size} categories)`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Adaptive thresholds calibration (Tier 1)
    // ═══════════════════════════════════════════════════════════════

    const totalFeedback = relevantSignals.length + irrelevantSignals.length;
    let suppressBelow = 0.25;
    let lowConfBelow = 0.45;

    if (totalFeedback > 10) {
      const relevantRatio = relevantSignals.length / totalFeedback;

      // If users approve most signals, we can tighten (lower thresholds = less filtering)
      // If users reject a lot, loosen (higher thresholds = more filtering)
      if (relevantRatio > 0.85) {
        // Very high approval — lower thresholds, let more through
        suppressBelow = 0.15;
        lowConfBelow = 0.35;
      } else if (relevantRatio > 0.7) {
        // Good approval — slight adjustment
        suppressBelow = 0.20;
        lowConfBelow = 0.40;
      } else if (relevantRatio < 0.4) {
        // High rejection — raise thresholds, filter more aggressively
        suppressBelow = 0.35;
        lowConfBelow = 0.55;
      } else if (relevantRatio < 0.6) {
        // Moderate rejection
        suppressBelow = 0.30;
        lowConfBelow = 0.50;
      }
      // else: keep defaults
    }

    await supabase.from('learning_profiles').upsert({
      profile_type: 'adaptive_thresholds',
      features: {
        suppress_below: suppressBelow,
        low_confidence_below: lowConfBelow,
        feedback_ratio: totalFeedback > 0 ? relevantSignals.length / totalFeedback : 0.5,
        total_feedback: totalFeedback,
        last_calibrated: new Date().toISOString()
      },
      sample_count: totalFeedback,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    console.log(`[Learning] Adaptive thresholds: suppress<${suppressBelow}, low_conf<${lowConfBelow} (${totalFeedback} feedback samples)`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Source reliability metrics
    // ═══════════════════════════════════════════════════════════════

    const sourceStats: Record<string, { total: number; relevant: number; irrelevant: number }> = {};
    for (const sig of (allSignals || [])) {
      const source = (sig.raw_json as any)?.source || 'unknown';
      if (!sourceStats[source]) sourceStats[source] = { total: 0, relevant: 0, irrelevant: 0 };
      sourceStats[source].total++;
      const fb = feedbackMap.get(sig.id);
      if (fb?.feedback === 'relevant') sourceStats[source].relevant++;
      if (fb?.feedback === 'irrelevant') sourceStats[source].irrelevant++;
    }

    const sourceUpserts = Object.entries(sourceStats).map(([sourceName, stats]) => {
      const feedbackTotal = stats.relevant + stats.irrelevant;
      const reliabilityScore = feedbackTotal > 0 ? stats.relevant / feedbackTotal : 0.5;
      return supabase.from('source_reliability_metrics').upsert({
        source_name: sourceName,
        total_signals: stats.total,
        accurate_signals: stats.relevant,
        false_positives: stats.irrelevant,
        reliability_score: Math.round(reliabilityScore * 100) / 100,
        last_updated: new Date().toISOString()
      }, { onConflict: 'source_name' });
    });

    await Promise.all(sourceUpserts);
    console.log(`[Learning] Updated ${sourceUpserts.length} source reliability metrics`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 6: Drift detection (Tier 3)
    // ═══════════════════════════════════════════════════════════════

    // Compare recent signal category distribution to historical baseline
    const recentSignals = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age < 7 * 24 * 60 * 60 * 1000; // Last 7 days
    });

    const olderSignals = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age >= 7 * 24 * 60 * 60 * 1000;
    });

    const recentDist: Record<string, number> = {};
    const olderDist: Record<string, number> = {};

    for (const s of recentSignals) {
      const cat = s.category || 'unknown';
      recentDist[cat] = (recentDist[cat] || 0) + 1;
    }
    for (const s of olderSignals) {
      const cat = s.category || 'unknown';
      olderDist[cat] = (olderDist[cat] || 0) + 1;
    }

    // Normalize distributions
    const recentTotal = recentSignals.length || 1;
    const olderTotal = olderSignals.length || 1;
    const allCategories = new Set([...Object.keys(recentDist), ...Object.keys(olderDist)]);
    const driftScores: Record<string, { recent_pct: number; baseline_pct: number; drift: number }> = {};
    let maxDrift = 0;

    for (const cat of allCategories) {
      const recentPct = (recentDist[cat] || 0) / recentTotal;
      const olderPct = (olderDist[cat] || 0) / olderTotal;
      const drift = Math.abs(recentPct - olderPct);
      driftScores[cat] = {
        recent_pct: Math.round(recentPct * 100) / 100,
        baseline_pct: Math.round(olderPct * 100) / 100,
        drift: Math.round(drift * 100) / 100
      };
      if (drift > maxDrift) maxDrift = drift;
    }

    const driftAlert = maxDrift > 0.2;
    const newCategories = Object.keys(recentDist).filter(c => !olderDist[c] && recentDist[c] > 2);

    await supabase.from('learning_profiles').upsert({
      profile_type: 'drift_baseline',
      features: {
        category_distribution: driftScores,
        max_drift: maxDrift,
        drift_alert: driftAlert,
        new_categories: newCategories,
        recent_window_signals: recentSignals.length,
        baseline_signals: olderSignals.length,
        analyzed_at: new Date().toISOString()
      },
      sample_count: (allSignals || []).length,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    if (driftAlert) {
      console.log(`[Learning] ⚠️ DRIFT DETECTED: max shift ${(maxDrift * 100).toFixed(0)}%. New categories: ${newCategories.join(', ') || 'none'}`);
    } else {
      console.log(`[Learning] Drift check: stable (max ${(maxDrift * 100).toFixed(0)}%)`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 7: Active learning queue (Tier 2)
    // ═══════════════════════════════════════════════════════════════

    // Find signals with relevance scores near the decision boundary (most uncertain)
    const uncertainSignals = (allSignals || [])
      .filter(s => {
        const rs = s.relevance_score;
        return rs !== null && rs >= 0.35 && rs <= 0.55 && !feedbackMap.has(s.id);
      })
      .sort((a, b) => {
        // Closest to 0.45 (boundary) first
        const distA = Math.abs((a.relevance_score || 0) - 0.45);
        const distB = Math.abs((b.relevance_score || 0) - 0.45);
        return distA - distB;
      })
      .slice(0, 20);

    await supabase.from('learning_profiles').upsert({
      profile_type: 'active_learning_queue',
      features: {
        signal_ids: uncertainSignals.map(s => s.id),
        scores: uncertainSignals.map(s => ({
          id: s.id,
          score: s.relevance_score,
          category: s.category,
          preview: (s.normalized_text || '').substring(0, 80)
        })),
        queue_size: uncertainSignals.length,
        generated_at: new Date().toISOString()
      },
      sample_count: uncertainSignals.length,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    console.log(`[Learning] Active learning queue: ${uncertainSignals.length} uncertain signals queued for review`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 8: Incident correlation learning (Tier 2)
    // ═══════════════════════════════════════════════════════════════

    let correlationInsights: any = { patterns: [], sample_size: 0 };

    if (incidentOutcomes && incidentOutcomes.length > 0) {
      const accurateIncidents = incidentOutcomes.filter(o => o.was_accurate);
      const falsePositiveIncidents = incidentOutcomes.filter(o => o.false_positive);

      correlationInsights = {
        total_outcomes: incidentOutcomes.length,
        accurate_count: accurateIncidents.length,
        false_positive_count: falsePositiveIncidents.length,
        accuracy_rate: incidentOutcomes.length > 0 ? accurateIncidents.length / incidentOutcomes.length : 0,
        sample_size: incidentOutcomes.length
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 9: Retroactive re-scoring of recent signals (Tier 1)
    // ═══════════════════════════════════════════════════════════════

    // Re-score signals from last 48 hours that haven't been reviewed
    const recentUnscored = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age < 48 * 60 * 60 * 1000 && !feedbackMap.has(s.id);
    });

    let rescored = 0;
    // Import and use the scorer to re-evaluate
    // Since we can't import ourselves, we'll do a simplified re-score based on updated profiles
    for (const sig of recentUnscored.slice(0, 50)) {
      const text = (sig.normalized_text || '').toLowerCase();
      const words = text.split(/\s+/).filter((w: string) => w.length > 3);
      let newScore = 0.5;

      // Apply approved patterns
      let approvedHits = 0;
      for (const word of words) {
        if (approvedFeatures[word]) approvedHits++;
      }
      if (words.length > 0 && approvedHits / words.length > 0.2) {
        newScore += 0.2;
      }

      // Apply rejected patterns
      let rejectedHits = 0;
      for (const word of words) {
        if (rejectedFeatures[word]) rejectedHits++;
      }
      if (words.length > 0 && rejectedHits / words.length > 0.3) {
        newScore -= 0.25;
      }

      newScore = Math.max(0.0, Math.min(1.0, newScore));

      // Only update if score changed significantly
      if (sig.relevance_score !== null && Math.abs(newScore - sig.relevance_score) > 0.1) {
        await supabase.from('signals').update({ relevance_score: newScore })
          .eq('id', sig.id);
        rescored++;
      }
    }

    console.log(`[Learning] Retroactive re-scoring: ${rescored}/${recentUnscored.length} signals updated`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 10: Store learning session record
    // ═══════════════════════════════════════════════════════════════

    const qualityScore = Math.min(1.0, totalFeedback / 50); // Scales to 1.0 at 50 feedback events

    const learnings = {
      signal_feedback: { relevant: relevantSignals.length, irrelevant: irrelevantSignals.length },
      entity_suggestions: {
        approved: (approvedSuggestions || []).filter(s => s.status === 'approved').length,
        rejected: (approvedSuggestions || []).filter(s => s.status === 'rejected').length
      },
      incident_correlation: correlationInsights,
      source_reliability: Object.entries(sourceStats).map(([name, s]) => ({
        source: name, total: s.total, relevant: s.relevant, irrelevant: s.irrelevant,
        score: s.relevant + s.irrelevant > 0 ? Math.round((s.relevant / (s.relevant + s.irrelevant)) * 100) / 100 : 0.5
      })),
      adaptive_thresholds: { suppress_below: suppressBelow, low_confidence_below: lowConfBelow },
      drift: { max_drift: maxDrift, alert: driftAlert, new_categories: newCategories },
      active_learning: { queue_size: uncertainSignals.length },
      retroactive_rescoring: { checked: recentUnscored.length, updated: rescored },
      profiles_updated: profileUpserts.length + 1, // +1 for adaptive thresholds
      category_profiles: categoryData.size,
      generated_at: new Date().toISOString()
    };

    await supabase.from('agent_learning_sessions').insert({
      session_type: 'full_adaptive_cycle',
      learnings,
      source_count: Object.keys(sourceStats).length,
      quality_score: qualityScore,
      promoted_to_global: true
    });

    // Also update entity patterns profile
    const approved = (approvedSuggestions || []).filter(s => s.status === 'approved');
    const rejected = (approvedSuggestions || []).filter(s => s.status === 'rejected');
    const entityFeatures: Record<string, number> = {};
    for (const s of approved) entityFeatures[`${s.suggested_type}:approved`] = (entityFeatures[`${s.suggested_type}:approved`] || 0) + 1;
    for (const s of rejected) entityFeatures[`${s.suggested_type}:rejected`] = (entityFeatures[`${s.suggested_type}:rejected`] || 0) + 1;

    if (Object.keys(entityFeatures).length > 0) {
      await supabase.from('learning_profiles').upsert({
        profile_type: 'entity_patterns',
        features: { ...entityFeatures, feedback_count: approved.length + rejected.length, source: 'automated_scan' },
        sample_count: approved.length + rejected.length,
        last_updated: new Date().toISOString(),
        weight: 1.0
      }, { onConflict: 'profile_type' });
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 11: Generate recommendations
    // ═══════════════════════════════════════════════════════════════

    const recommendations = [];

    if (irrelevantSignals.length > relevantSignals.length && totalFeedback > 10) {
      recommendations.push({
        area: 'Signal Quality', priority: 'high',
        issue: `${irrelevantSignals.length}/${totalFeedback} signals marked irrelevant`,
        action: 'Review ingestion filters — more noise than signal'
      });
    }

    const lowReliability = Object.entries(sourceStats)
      .filter(([_, s]) => s.irrelevant > s.relevant && (s.relevant + s.irrelevant) > 2)
      .map(([name]) => name);
    if (lowReliability.length > 0) {
      recommendations.push({
        area: 'Source Management', priority: 'medium',
        issue: `${lowReliability.length} sources produce more noise than signal`,
        action: 'Consider disabling or retuning', sources: lowReliability
      });
    }

    if (driftAlert) {
      recommendations.push({
        area: 'Threat Landscape', priority: 'high',
        issue: `Signal distribution shifted ${(maxDrift * 100).toFixed(0)}% from baseline`,
        action: 'New threat categories emerging — review and adapt monitoring'
      });
    }

    if (newCategories.length > 0) {
      recommendations.push({
        area: 'New Categories', priority: 'medium',
        issue: `${newCategories.length} new signal categories detected: ${newCategories.join(', ')}`,
        action: 'Verify these are legitimate categories and configure appropriate responses'
      });
    }

    if (uncertainSignals.length > 10) {
      recommendations.push({
        area: 'Active Learning', priority: 'low',
        issue: `${uncertainSignals.length} signals near decision boundary need human review`,
        action: 'Review queued signals to improve classifier precision'
      });
    }

    console.log(`[Learning] ═══ Cycle complete: ${recommendations.length} recommendations ═══`);

    return successResponse({
      success: true,
      cycle: 'full_adaptive',
      metrics: {
        signal_feedback_total: totalFeedback,
        relevant_signals: relevantSignals.length,
        irrelevant_signals: irrelevantSignals.length,
        sources_tracked: Object.keys(sourceStats).length,
        category_profiles: categoryData.size,
        quality_score: qualityScore,
        adaptive_thresholds: { suppress_below: suppressBelow, low_confidence_below: lowConfBelow },
        drift: { max_drift: maxDrift, alert: driftAlert, new_categories: newCategories },
        active_learning_queue: uncertainSignals.length,
        retroactive_rescored: rescored
      },
      recommendations,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Learning] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
