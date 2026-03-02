import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    console.log('[Learning] ═══ Starting full adaptive learning cycle v3 ═══');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Gather all feedback data
    // ═══════════════════════════════════════════════════════════════

    const [
      { data: signalFeedback },
      { data: approvedSuggestions },
      { data: incidentOutcomes },
      { data: allSignals },
      { data: implicitEvents }
    ] = await Promise.all([
      supabase.from('feedback_events').select('object_id, feedback, user_id, created_at')
        .eq('object_type', 'signal').order('created_at', { ascending: false }).limit(500),
      supabase.from('entity_suggestions').select('suggested_name, suggested_type, context, confidence, source_type, status')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('incident_outcomes').select('incident_id, false_positive, was_accurate').limit(200),
      supabase.from('signals').select('id, normalized_text, category, severity, relevance_score, raw_json, created_at')
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('implicit_feedback_events').select('signal_id, user_id, event_type, event_value, created_at')
        .order('created_at', { ascending: false }).limit(1000)
    ]);

    const feedbackMap = new Map<string, { feedback: string; created_at: string; user_id: string }>();
    for (const fb of (signalFeedback || [])) {
      feedbackMap.set(fb.object_id, { feedback: fb.feedback, created_at: fb.created_at, user_id: fb.user_id });
    }

    const relevantSignals = (allSignals || []).filter(s => feedbackMap.get(s.id)?.feedback === 'relevant');
    const irrelevantSignals = (allSignals || []).filter(s => feedbackMap.get(s.id)?.feedback === 'irrelevant');

    console.log(`[Learning] Data: ${allSignals?.length || 0} signals, ${relevantSignals.length} relevant, ${irrelevantSignals.length} irrelevant, ${implicitEvents?.length || 0} implicit events`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Analyst accuracy & consensus weighting
    // ═══════════════════════════════════════════════════════════════

    const analystStats = new Map<string, { total: number; accurate: number }>();

    // For each feedback, check if the analyst's assessment aligned with majority consensus
    const signalConsensus = new Map<string, { relevant: number; irrelevant: number }>();
    for (const fb of (signalFeedback || [])) {
      if (!signalConsensus.has(fb.object_id)) signalConsensus.set(fb.object_id, { relevant: 0, irrelevant: 0 });
      const consensus = signalConsensus.get(fb.object_id)!;
      if (fb.feedback === 'relevant') consensus.relevant++;
      else consensus.irrelevant++;
    }

    for (const fb of (signalFeedback || [])) {
      const userId = fb.user_id;
      if (!userId) continue;
      if (!analystStats.has(userId)) analystStats.set(userId, { total: 0, accurate: 0 });
      const stats = analystStats.get(userId)!;
      stats.total++;

      const consensus = signalConsensus.get(fb.object_id);
      if (consensus) {
        const majorityFeedback = consensus.relevant >= consensus.irrelevant ? 'relevant' : 'irrelevant';
        if (fb.feedback === majorityFeedback) stats.accurate++;
      }
    }

    // Upsert analyst accuracy metrics
    const analystUpserts = [];
    for (const [userId, stats] of analystStats.entries()) {
      if (stats.total < 3) continue;
      const accuracyScore = stats.accurate / stats.total;
      // Weight multiplier: top analysts get 1.5x, poor ones get 0.5x
      const weight = 0.5 + (accuracyScore * 1.0);
      analystUpserts.push(supabase.from('analyst_accuracy_metrics').upsert({
        user_id: userId,
        total_feedback: stats.total,
        accurate_feedback: stats.accurate,
        accuracy_score: Math.round(accuracyScore * 100) / 100,
        weight_multiplier: Math.round(weight * 100) / 100,
        last_calibrated: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    }
    await Promise.all(analystUpserts);
    console.log(`[Learning] Analyst accuracy: ${analystUpserts.length} analysts calibrated`);

    // Load analyst weights for weighted profile building
    const { data: analystWeights } = await supabase.from('analyst_accuracy_metrics')
      .select('user_id, weight_multiplier');
    const weightMap = new Map<string, number>();
    for (const aw of (analystWeights || [])) {
      weightMap.set(aw.user_id, aw.weight_multiplier);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Build weighted learning profiles (analyst-weighted)
    // ═══════════════════════════════════════════════════════════════

    const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

    function buildWeightedFeatures(signals: any[]): Record<string, number> {
      const features: Record<string, number> = {};
      for (const sig of signals) {
        const fb = feedbackMap.get(sig.id);
        const ageMs = fb ? Date.now() - new Date(fb.created_at).getTime() : HALF_LIFE_MS;
        const temporalDecay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
        const analystWeight = fb?.user_id ? (weightMap.get(fb.user_id) || 1.0) : 1.0;
        const combinedWeight = temporalDecay * analystWeight;
        const words = (sig.normalized_text || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        for (const word of words) {
          features[word] = (features[word] || 0) + combinedWeight;
        }
      }
      return features;
    }

    const approvedFeatures = buildWeightedFeatures(relevantSignals);
    const rejectedFeatures = buildWeightedFeatures(irrelevantSignals);

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
    // PHASE 4: Implicit feedback processing
    // ═══════════════════════════════════════════════════════════════

    const implicitScores = new Map<string, number>();
    for (const evt of (implicitEvents || [])) {
      const current = implicitScores.get(evt.signal_id) || 0;
      switch (evt.event_type) {
        case 'escalated': implicitScores.set(evt.signal_id, current + 0.3); break;
        case 'included_in_report': implicitScores.set(evt.signal_id, current + 0.25); break;
        case 'investigated': implicitScores.set(evt.signal_id, current + 0.2); break;
        case 'shared': implicitScores.set(evt.signal_id, current + 0.15); break;
        case 'view_duration':
          // >30s of viewing = positive signal
          if (evt.event_value && evt.event_value > 30) implicitScores.set(evt.signal_id, current + 0.1);
          break;
        case 'dismissed_quickly':
          implicitScores.set(evt.signal_id, current - 0.15);
          break;
      }
    }

    // Merge implicit signals into features for signals without explicit feedback
    const implicitApproved: any[] = [];
    const implicitRejected: any[] = [];
    for (const [sigId, implScore] of implicitScores.entries()) {
      if (feedbackMap.has(sigId)) continue; // Explicit feedback takes precedence
      const sig = (allSignals || []).find(s => s.id === sigId);
      if (!sig) continue;
      if (implScore >= 0.2) implicitApproved.push(sig);
      else if (implScore <= -0.1) implicitRejected.push(sig);
    }

    if (implicitApproved.length > 2) {
      const implApprovedFeatures = buildWeightedFeatures(implicitApproved);
      profileUpserts.push(supabase.from('learning_profiles').upsert({
        profile_type: 'implicit_approved_patterns',
        features: implApprovedFeatures,
        sample_count: implicitApproved.length,
        last_updated: new Date().toISOString(),
        weight: 0.6 // Lower weight than explicit feedback
      }, { onConflict: 'profile_type' }));
    }

    console.log(`[Learning] Implicit feedback: ${implicitApproved.length} implicit approvals, ${implicitRejected.length} implicit rejections`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Category-specific profiles
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
      profileUpserts.push(supabase.from('learning_profiles').upsert({
        profile_type: `category:${category}`,
        features: {
          approved_features: buildWeightedFeatures(data.approved),
          rejected_features: buildWeightedFeatures(data.rejected),
          approved_count: data.approved.length,
          rejected_count: data.rejected.length
        },
        sample_count: data.approved.length + data.rejected.length,
        last_updated: new Date().toISOString(),
        weight: 1.0
      }, { onConflict: 'profile_type' }));
    }

    await Promise.all(profileUpserts);
    console.log(`[Learning] Updated ${profileUpserts.length} profiles (${categoryData.size} categories)`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 6: Adaptive thresholds calibration
    // ═══════════════════════════════════════════════════════════════

    const totalFeedback = relevantSignals.length + irrelevantSignals.length;
    // Hardened defaults — never go below these floors
    let suppressBelow = 0.35;
    let lowConfBelow = 0.60;

    if (totalFeedback > 10) {
      const relevantRatio = relevantSignals.length / totalFeedback;
      // Only TIGHTEN thresholds further if noise ratio is high; never loosen below floors
      if (relevantRatio < 0.4) { suppressBelow = 0.45; lowConfBelow = 0.70; }
      else if (relevantRatio < 0.6) { suppressBelow = 0.40; lowConfBelow = 0.65; }
      // If signal quality is very high (>85% relevant), we can slightly relax but NOT below floors
      else if (relevantRatio > 0.85 && totalFeedback > 30) { suppressBelow = 0.30; lowConfBelow = 0.55; }
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

    console.log(`[Learning] Adaptive thresholds: suppress<${suppressBelow}, low_conf<${lowConfBelow}`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 7: Source reliability metrics
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
    // PHASE 8: Cross-signal correlation clustering
    // ═══════════════════════════════════════════════════════════════

    // Group signals by entity mentions and temporal proximity
    const recentSignals = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age < 48 * 60 * 60 * 1000; // Last 48h
    });

    const clusters: Array<{ label: string; signals: string[]; entities: string[]; score: number }> = [];

    // Extract entity mentions from signal text for correlation
    const signalEntities = new Map<string, Set<string>>();
    for (const sig of recentSignals) {
      const text = (sig.normalized_text || '').toLowerCase();
      // Simple entity extraction: capitalized words, known entities from raw_json
      const rawEntities = (sig.raw_json as any)?.entities || [];
      const entities = new Set<string>(rawEntities.map((e: any) => typeof e === 'string' ? e : e.name || '').filter(Boolean));
      signalEntities.set(sig.id, entities);
    }

    // Find signals sharing entities within temporal windows
    const processed = new Set<string>();
    for (const sig of recentSignals) {
      if (processed.has(sig.id)) continue;
      const entities = signalEntities.get(sig.id) || new Set();
      if (entities.size === 0) continue;

      const clusterSignals = [sig.id];
      const clusterEntities = new Set(entities);

      for (const other of recentSignals) {
        if (other.id === sig.id || processed.has(other.id)) continue;
        const otherEntities = signalEntities.get(other.id) || new Set();
        const overlap = [...entities].filter(e => otherEntities.has(e));
        if (overlap.length > 0) {
          clusterSignals.push(other.id);
          for (const e of otherEntities) clusterEntities.add(e);
          processed.add(other.id);
        }
      }

      if (clusterSignals.length >= 2) {
        const clusterScore = Math.min(1.0, clusterSignals.length * 0.2 + clusterEntities.size * 0.1);
        clusters.push({
          label: `Cluster: ${[...clusterEntities].slice(0, 3).join(', ')}`,
          signals: clusterSignals,
          entities: [...clusterEntities],
          score: clusterScore
        });
      }
      processed.add(sig.id);
    }

    // Store clusters
    if (clusters.length > 0) {
      // Clear old clusters and insert new
      await supabase.from('signal_clusters').delete().lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
      for (const cluster of clusters.slice(0, 20)) {
        await supabase.from('signal_clusters').insert({
          cluster_label: cluster.label,
          signal_ids: cluster.signals,
          entity_overlap: cluster.entities,
          temporal_window_hours: 48,
          cluster_score: cluster.score
        });
      }
    }
    console.log(`[Learning] Cross-signal correlation: ${clusters.length} clusters detected`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 9: Seasonal/temporal pattern recognition
    // ═══════════════════════════════════════════════════════════════

    const monthlyDist: Record<string, Record<number, number>> = {};
    const dowDist: Record<string, Record<number, number>> = {};
    const totalByMonth: Record<number, number> = {};
    const totalByDow: Record<number, number> = {};

    for (const sig of (allSignals || [])) {
      const d = new Date(sig.created_at);
      const month = d.getMonth() + 1;
      const dow = d.getDay();
      const cat = sig.category || 'unknown';

      if (!monthlyDist[cat]) monthlyDist[cat] = {};
      if (!dowDist[cat]) dowDist[cat] = {};
      monthlyDist[cat][month] = (monthlyDist[cat][month] || 0) + 1;
      dowDist[cat][dow] = (dowDist[cat][dow] || 0) + 1;
      totalByMonth[month] = (totalByMonth[month] || 0) + 1;
      totalByDow[dow] = (totalByDow[dow] || 0) + 1;
    }

    // Normalize to identify spikes (ratio vs average)
    const totalSignals = (allSignals || []).length;
    const avgPerMonth = totalSignals / 12;
    const avgPerDow = totalSignals / 7;

    const monthlySpikes: Record<string, Record<number, number>> = {};
    const dowPatterns: Record<string, Record<number, number>> = {};

    for (const [cat, months] of Object.entries(monthlyDist)) {
      monthlySpikes[cat] = {};
      const catTotal = Object.values(months).reduce((a, b) => a + b, 0);
      const catAvg = catTotal / 12;
      if (catAvg < 1) continue;
      for (const [m, count] of Object.entries(months)) {
        monthlySpikes[cat][Number(m)] = Math.round((count / catAvg) * 100) / 100;
      }
    }

    for (const [cat, days] of Object.entries(dowDist)) {
      dowPatterns[cat] = {};
      const catTotal = Object.values(days).reduce((a, b) => a + b, 0);
      const catAvg = catTotal / 7;
      if (catAvg < 1) continue;
      for (const [d, count] of Object.entries(days)) {
        dowPatterns[cat][Number(d)] = Math.round((count / catAvg) * 100) / 100;
      }
    }

    await supabase.from('learning_profiles').upsert({
      profile_type: 'seasonal_patterns',
      features: {
        monthly_spikes: monthlySpikes,
        dow_patterns: dowPatterns,
        total_signals: totalSignals,
        analyzed_at: new Date().toISOString()
      },
      sample_count: totalSignals,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    console.log(`[Learning] Seasonal patterns: ${Object.keys(monthlySpikes).length} categories analyzed`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 10: Drift detection
    // ═══════════════════════════════════════════════════════════════

    const recentWeek = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age < 7 * 24 * 60 * 60 * 1000;
    });
    const olderSignals = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age >= 7 * 24 * 60 * 60 * 1000;
    });

    const recentDist: Record<string, number> = {};
    const olderDist: Record<string, number> = {};
    for (const s of recentWeek) { const cat = s.category || 'unknown'; recentDist[cat] = (recentDist[cat] || 0) + 1; }
    for (const s of olderSignals) { const cat = s.category || 'unknown'; olderDist[cat] = (olderDist[cat] || 0) + 1; }

    const recentTotal = recentWeek.length || 1;
    const olderTotal = olderSignals.length || 1;
    const allCategories = new Set([...Object.keys(recentDist), ...Object.keys(olderDist)]);
    const driftScores: Record<string, { recent_pct: number; baseline_pct: number; drift: number }> = {};
    let maxDrift = 0;

    for (const cat of allCategories) {
      const recentPct = (recentDist[cat] || 0) / recentTotal;
      const olderPct = (olderDist[cat] || 0) / olderTotal;
      const drift = Math.abs(recentPct - olderPct);
      driftScores[cat] = { recent_pct: Math.round(recentPct * 100) / 100, baseline_pct: Math.round(olderPct * 100) / 100, drift: Math.round(drift * 100) / 100 };
      if (drift > maxDrift) maxDrift = drift;
    }

    const driftAlert = maxDrift > 0.2;
    const newCategories = Object.keys(recentDist).filter(c => !olderDist[c] && recentDist[c] > 2);

    await supabase.from('learning_profiles').upsert({
      profile_type: 'drift_baseline',
      features: {
        category_distribution: driftScores, max_drift: maxDrift, drift_alert: driftAlert,
        new_categories: newCategories, recent_window_signals: recentWeek.length,
        baseline_signals: olderSignals.length, analyzed_at: new Date().toISOString()
      },
      sample_count: (allSignals || []).length,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    if (driftAlert) console.log(`[Learning] ⚠️ DRIFT: max shift ${(maxDrift * 100).toFixed(0)}%`);
    else console.log(`[Learning] Drift check: stable (max ${(maxDrift * 100).toFixed(0)}%)`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 11: Active learning queue
    // ═══════════════════════════════════════════════════════════════

    const uncertainSignals = (allSignals || [])
      .filter(s => {
        const rs = s.relevance_score;
        return rs !== null && rs >= 0.35 && rs <= 0.55 && !feedbackMap.has(s.id);
      })
      .sort((a, b) => Math.abs((a.relevance_score || 0) - 0.45) - Math.abs((b.relevance_score || 0) - 0.45))
      .slice(0, 20);

    await supabase.from('learning_profiles').upsert({
      profile_type: 'active_learning_queue',
      features: {
        signal_ids: uncertainSignals.map(s => s.id),
        scores: uncertainSignals.map(s => ({
          id: s.id, score: s.relevance_score, category: s.category,
          preview: (s.normalized_text || '').substring(0, 80)
        })),
        queue_size: uncertainSignals.length,
        generated_at: new Date().toISOString()
      },
      sample_count: uncertainSignals.length,
      last_updated: new Date().toISOString(),
      weight: 1.0
    }, { onConflict: 'profile_type' });

    console.log(`[Learning] Active learning queue: ${uncertainSignals.length} signals`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 12: Retroactive re-scoring
    // ═══════════════════════════════════════════════════════════════

    const recentUnscored = (allSignals || []).filter(s => {
      const age = Date.now() - new Date(s.created_at).getTime();
      return age < 48 * 60 * 60 * 1000 && !feedbackMap.has(s.id);
    });

    let rescored = 0;
    for (const sig of recentUnscored.slice(0, 50)) {
      const text = (sig.normalized_text || '').toLowerCase();
      const words = text.split(/\s+/).filter((w: string) => w.length > 3);
      let newScore = 0.5;

      let approvedHits = 0;
      for (const word of words) { if (approvedFeatures[word]) approvedHits++; }
      if (words.length > 0 && approvedHits / words.length > 0.2) newScore += 0.2;

      let rejectedHits = 0;
      for (const word of words) { if (rejectedFeatures[word]) rejectedHits++; }
      if (words.length > 0 && rejectedHits / words.length > 0.3) newScore -= 0.25;

      // Apply implicit feedback if available
      const implScore = implicitScores.get(sig.id);
      if (implScore) newScore += implScore * 0.3;

      newScore = Math.max(0.0, Math.min(1.0, newScore));

      if (sig.relevance_score !== null && Math.abs(newScore - sig.relevance_score) > 0.1) {
        await supabase.from('signals').update({ relevance_score: newScore }).eq('id', sig.id);
        rescored++;
      }
    }

    console.log(`[Learning] Retroactive re-scoring: ${rescored}/${recentUnscored.length} signals updated`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 13: Store learning session record
    // ═══════════════════════════════════════════════════════════════

    let correlationInsights: any = { patterns: [], sample_size: 0 };
    if (incidentOutcomes && incidentOutcomes.length > 0) {
      const accurateIncidents = incidentOutcomes.filter(o => o.was_accurate);
      const falsePositiveIncidents = incidentOutcomes.filter(o => o.false_positive);
      correlationInsights = {
        total_outcomes: incidentOutcomes.length,
        accurate_count: accurateIncidents.length,
        false_positive_count: falsePositiveIncidents.length,
        accuracy_rate: accurateIncidents.length / incidentOutcomes.length,
        sample_size: incidentOutcomes.length
      };
    }

    const qualityScore = Math.min(1.0, totalFeedback / 50);

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
      analyst_consensus: { analysts_calibrated: analystUpserts.length },
      implicit_feedback: { approvals: implicitApproved.length, rejections: implicitRejected.length, total_events: implicitEvents?.length || 0 },
      cross_signal_clusters: { count: clusters.length, top_clusters: clusters.slice(0, 5).map(c => ({ label: c.label, size: c.signals.length, score: c.score })) },
      seasonal_patterns: { categories_analyzed: Object.keys(monthlySpikes).length },
      universal_feedback: Object.fromEntries(Object.entries(universalStats || {}).map(([type, stats]) => [type, { positive: stats.positive, negative: stats.negative, total: stats.total }])),
      profiles_updated: profileUpserts.length + 1,
      category_profiles: categoryData.size,
      generated_at: new Date().toISOString()
    };

    await supabase.from('agent_learning_sessions').insert({
      session_type: 'full_adaptive_cycle_v3',
      learnings,
      source_count: Object.keys(sourceStats).length,
      quality_score: qualityScore,
      promoted_to_global: true
    });

    // Entity patterns profile
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
    // PHASE 14: Universal feedback learning (briefings, reports, travel alerts, etc.)
    // ═══════════════════════════════════════════════════════════════

    const { data: universalFeedback } = await supabase
      .from('feedback_events')
      .select('object_type, feedback, notes, correction, feedback_context, source_function, created_at')
      .neq('object_type', 'signal')
      .order('created_at', { ascending: false })
      .limit(500);

    const universalStats: Record<string, { positive: number; negative: number; total: number; corrections: string[] }> = {};
    
    for (const fb of (universalFeedback || [])) {
      const type = fb.object_type || 'unknown';
      if (!universalStats[type]) universalStats[type] = { positive: 0, negative: 0, total: 0, corrections: [] };
      universalStats[type].total++;
      
      if (['positive', 'relevant', 'confirmed', 'approved'].includes(fb.feedback)) {
        universalStats[type].positive++;
      } else {
        universalStats[type].negative++;
      }
      
      if (fb.correction) {
        universalStats[type].corrections.push(fb.correction);
      }
    }

    // Upsert quality profiles for each object type
    for (const [type, stats] of Object.entries(universalStats)) {
      if (stats.total < 1) continue;
      const satisfactionRate = stats.total > 0 ? stats.positive / stats.total : 0.5;
      
      await supabase.from('learning_profiles').upsert({
        profile_type: `quality:${type}`,
        features: {
          positive_count: stats.positive,
          negative_count: stats.negative,
          total_feedback: stats.total,
          satisfaction_rate: Math.round(satisfactionRate * 100) / 100,
          correction_count: stats.corrections.length,
          recent_corrections: stats.corrections.slice(0, 5),
          last_analyzed: new Date().toISOString(),
        },
        sample_count: stats.total,
        last_updated: new Date().toISOString(),
        weight: 1.0,
      }, { onConflict: 'profile_type' });
    }

    console.log(`[Learning] Universal feedback: ${Object.keys(universalStats).length} object types, ${(universalFeedback || []).length} total events`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 15: Recommendations
    // ═══════════════════════════════════════════════════════════════

    const recommendations = [];

    if (irrelevantSignals.length > relevantSignals.length && totalFeedback > 10) {
      recommendations.push({ area: 'Signal Quality', priority: 'high', issue: `${irrelevantSignals.length}/${totalFeedback} signals marked irrelevant`, action: 'Review ingestion filters' });
    }
    const lowReliability = Object.entries(sourceStats).filter(([_, s]) => s.irrelevant > s.relevant && (s.relevant + s.irrelevant) > 2).map(([name]) => name);
    if (lowReliability.length > 0) {
      recommendations.push({ area: 'Source Management', priority: 'medium', issue: `${lowReliability.length} sources produce more noise than signal`, action: 'Consider disabling or retuning', sources: lowReliability });
    }
    if (driftAlert) {
      recommendations.push({ area: 'Threat Landscape', priority: 'high', issue: `Signal distribution shifted ${(maxDrift * 100).toFixed(0)}%`, action: 'New threat categories emerging' });
    }
    if (clusters.length > 3) {
      recommendations.push({ area: 'Signal Clusters', priority: 'medium', issue: `${clusters.length} correlated signal clusters detected`, action: 'Review clusters for coordinated threat patterns' });
    }
    if (uncertainSignals.length > 10) {
      recommendations.push({ area: 'Active Learning', priority: 'low', issue: `${uncertainSignals.length} signals need human review`, action: 'Review queued signals to improve precision' });
    }

    // Universal feedback recommendations
    for (const [type, stats] of Object.entries(universalStats)) {
      if (stats.total >= 3 && stats.negative > stats.positive) {
        recommendations.push({
          area: `${type.replace(/_/g, ' ')} Quality`,
          priority: stats.negative / stats.total > 0.7 ? 'high' : 'medium',
          issue: `${stats.negative}/${stats.total} ${type} outputs rated negatively`,
          action: `Review AI prompts and content quality for ${type}`,
        });
      }
    }

    console.log(`[Learning] ═══ Cycle v3 complete: ${recommendations.length} recommendations ═══`);

    return successResponse({
      success: true,
      cycle: 'full_adaptive_v3',
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
        retroactive_rescored: rescored,
        analysts_calibrated: analystUpserts.length,
        implicit_feedback_events: implicitEvents?.length || 0,
        signal_clusters: clusters.length,
        seasonal_categories: Object.keys(monthlySpikes).length
      },
      recommendations,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Learning] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
