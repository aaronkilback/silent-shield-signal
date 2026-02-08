import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('[Learning] Starting learning context generation...');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Gather feedback data from all sources
    // ═══════════════════════════════════════════════════════════════

    // 1a. Signal feedback (relevant/irrelevant marks from users)
    const { data: signalFeedback } = await supabase
      .from('feedback_events')
      .select('object_id, feedback, created_at')
      .eq('object_type', 'signal')
      .order('created_at', { ascending: false })
      .limit(500);

    // 1b. Entity suggestions feedback
    const { data: approvedSuggestions } = await supabase
      .from('entity_suggestions')
      .select('suggested_name, suggested_type, context, confidence, source_type, status')
      .order('created_at', { ascending: false })
      .limit(200);

    // 1c. Incident outcomes (if any exist)
    const { data: incidentOutcomes } = await supabase
      .from('incident_outcomes')
      .select('incident_id, false_positive, was_accurate')
      .limit(100);

    // 1d. Get signal text for feedback items to build word profiles
    const relevantIds = (signalFeedback || [])
      .filter(f => f.feedback === 'relevant')
      .map(f => f.object_id)
      .slice(0, 100);
    
    const irrelevantIds = (signalFeedback || [])
      .filter(f => f.feedback === 'irrelevant')
      .map(f => f.object_id)
      .slice(0, 100);

    let relevantSignals: any[] = [];
    let irrelevantSignals: any[] = [];

    if (relevantIds.length > 0) {
      const { data } = await supabase
        .from('signals')
        .select('id, normalized_text, category, raw_json')
        .in('id', relevantIds);
      relevantSignals = data || [];
    }

    if (irrelevantIds.length > 0) {
      const { data } = await supabase
        .from('signals')
        .select('id, normalized_text, category, raw_json')
        .in('id', irrelevantIds);
      irrelevantSignals = data || [];
    }

    console.log(`[Learning] Feedback: ${relevantIds.length} relevant, ${irrelevantIds.length} irrelevant signals`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Build/refresh learning profiles from feedback
    // ═══════════════════════════════════════════════════════════════

    // Build word frequency profiles from approved (relevant) signals
    const approvedFeatures: Record<string, number> = {};
    for (const sig of relevantSignals) {
      const words = (sig.normalized_text || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      for (const word of words) {
        approvedFeatures[word] = (approvedFeatures[word] || 0) + 1;
      }
    }

    // Build word frequency profiles from rejected (irrelevant) signals
    const rejectedFeatures: Record<string, number> = {};
    for (const sig of irrelevantSignals) {
      const words = (sig.normalized_text || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      for (const word of words) {
        rejectedFeatures[word] = (rejectedFeatures[word] || 0) + 1;
      }
    }

    // Upsert learning profiles
    if (Object.keys(approvedFeatures).length > 0) {
      await supabase
        .from('learning_profiles')
        .upsert({
          profile_type: 'approved_signal_patterns',
          features: approvedFeatures,
          sample_count: relevantSignals.length,
          last_updated: new Date().toISOString(),
          weight: 1.0
        }, { onConflict: 'profile_type' });
      console.log(`[Learning] Updated approved_signal_patterns: ${relevantSignals.length} samples, ${Object.keys(approvedFeatures).length} features`);
    }

    if (Object.keys(rejectedFeatures).length > 0) {
      await supabase
        .from('learning_profiles')
        .upsert({
          profile_type: 'rejected_signal_patterns',
          features: rejectedFeatures,
          sample_count: irrelevantSignals.length,
          last_updated: new Date().toISOString(),
          weight: 1.0
        }, { onConflict: 'profile_type' });
      console.log(`[Learning] Updated rejected_signal_patterns: ${irrelevantSignals.length} samples, ${Object.keys(rejectedFeatures).length} features`);
    }

    // Entity pattern profile from approved suggestions
    const entityFeatures: Record<string, number> = {};
    const approved = (approvedSuggestions || []).filter(s => s.status === 'approved');
    const rejected = (approvedSuggestions || []).filter(s => s.status === 'rejected');
    for (const s of approved) {
      const key = `${s.suggested_type}:approved`;
      entityFeatures[key] = (entityFeatures[key] || 0) + 1;
    }
    for (const s of rejected) {
      const key = `${s.suggested_type}:rejected`;
      entityFeatures[key] = (entityFeatures[key] || 0) + 1;
    }

    if (Object.keys(entityFeatures).length > 0) {
      await supabase
        .from('learning_profiles')
        .upsert({
          profile_type: 'entity_patterns',
          features: { ...entityFeatures, feedback_count: approved.length + rejected.length, source: 'automated_scan' },
          sample_count: approved.length + rejected.length,
          last_updated: new Date().toISOString(),
          weight: 1.0
        }, { onConflict: 'profile_type' });
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Calculate source reliability metrics
    // ═══════════════════════════════════════════════════════════════

    // Get all signals grouped by source
    const { data: allSignals } = await supabase
      .from('signals')
      .select('id, raw_json, category')
      .limit(1000);

    // Group signals by source
    const sourceStats: Record<string, { total: number; relevant: number; irrelevant: number; ids: string[] }> = {};
    for (const sig of (allSignals || [])) {
      const source = (sig.raw_json as any)?.source || 'unknown';
      if (!sourceStats[source]) {
        sourceStats[source] = { total: 0, relevant: 0, irrelevant: 0, ids: [] };
      }
      sourceStats[source].total++;
      sourceStats[source].ids.push(sig.id);
    }

    // Cross-reference with feedback
    const feedbackMap = new Map<string, string>();
    for (const fb of (signalFeedback || [])) {
      feedbackMap.set(fb.object_id, fb.feedback);
    }

    for (const [source, stats] of Object.entries(sourceStats)) {
      for (const id of stats.ids) {
        const fb = feedbackMap.get(id);
        if (fb === 'relevant') stats.relevant++;
        if (fb === 'irrelevant') stats.irrelevant++;
      }
    }

    // Upsert source reliability metrics
    for (const [sourceName, stats] of Object.entries(sourceStats)) {
      if (stats.total < 1) continue;
      
      // Calculate reliability: base 0.5 + bonus for relevant - penalty for irrelevant
      const feedbackTotal = stats.relevant + stats.irrelevant;
      let reliabilityScore = 0.5; // neutral baseline
      if (feedbackTotal > 0) {
        reliabilityScore = stats.relevant / feedbackTotal;
      }

      await supabase
        .from('source_reliability_metrics')
        .upsert({
          source_name: sourceName,
          total_signals: stats.total,
          accurate_signals: stats.relevant,
          false_positives: stats.irrelevant,
          reliability_score: Math.round(reliabilityScore * 100) / 100,
          last_updated: new Date().toISOString()
        }, { onConflict: 'source_name' });
    }

    console.log(`[Learning] Updated reliability for ${Object.keys(sourceStats).length} sources`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Store learning session record
    // ═══════════════════════════════════════════════════════════════

    const totalFeedback = (signalFeedback || []).length;
    const totalApproved = approved.length;
    const totalRejected = rejected.length;
    const totalOutcomes = (incidentOutcomes || []).length;
    const sourceCount = Object.keys(sourceStats).length;

    const qualityScore = Math.min(1.0, (totalFeedback + totalApproved + totalRejected) / 100);

    const learnings = {
      signal_feedback: { relevant: relevantIds.length, irrelevant: irrelevantIds.length },
      entity_suggestions: { approved: totalApproved, rejected: totalRejected },
      incident_outcomes: totalOutcomes,
      source_reliability: Object.entries(sourceStats).map(([name, s]) => ({
        source: name,
        total: s.total,
        relevant: s.relevant,
        irrelevant: s.irrelevant,
        score: s.relevant + s.irrelevant > 0 ? Math.round((s.relevant / (s.relevant + s.irrelevant)) * 100) / 100 : 0.5
      })),
      profiles_updated: [
        Object.keys(approvedFeatures).length > 0 ? 'approved_signal_patterns' : null,
        Object.keys(rejectedFeatures).length > 0 ? 'rejected_signal_patterns' : null,
        Object.keys(entityFeatures).length > 0 ? 'entity_patterns' : null
      ].filter(Boolean),
      generated_at: new Date().toISOString()
    };

    const { error: sessionError } = await supabase
      .from('agent_learning_sessions')
      .insert({
        session_type: 'automated_feedback_analysis',
        learnings,
        source_count: sourceCount,
        quality_score: qualityScore,
        promoted_to_global: true
      });

    if (sessionError) {
      console.error('[Learning] Failed to store session:', sessionError);
    } else {
      console.log(`[Learning] Session stored. Quality: ${qualityScore.toFixed(2)}, Sources: ${sourceCount}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Generate recommendations
    // ═══════════════════════════════════════════════════════════════

    const recommendations = [];

    if (irrelevantIds.length > relevantIds.length && totalFeedback > 10) {
      recommendations.push({
        area: 'Signal Quality',
        issue: `${irrelevantIds.length}/${totalFeedback} signals marked irrelevant`,
        action: 'Review ingestion filters — more noise than signal'
      });
    }

    const lowReliabilitySources = Object.entries(sourceStats)
      .filter(([_, s]) => s.irrelevant > s.relevant && (s.relevant + s.irrelevant) > 2)
      .map(([name]) => name);
    
    if (lowReliabilitySources.length > 0) {
      recommendations.push({
        area: 'Source Management',
        issue: `${lowReliabilitySources.length} sources producing more noise than signal`,
        action: 'Consider disabling or retuning these sources',
        sources: lowReliabilitySources
      });
    }

    if (totalRejected > totalApproved * 2 && totalRejected > 5) {
      recommendations.push({
        area: 'Entity Extraction',
        issue: `High rejection rate: ${totalRejected} rejected vs ${totalApproved} approved`,
        action: 'Improve entity extraction prompts for precision'
      });
    }

    console.log(`[Learning] Complete. ${recommendations.length} recommendations generated.`);

    return successResponse({
      success: true,
      metrics: {
        signal_feedback_total: totalFeedback,
        relevant_signals: relevantIds.length,
        irrelevant_signals: irrelevantIds.length,
        entity_approved: totalApproved,
        entity_rejected: totalRejected,
        sources_tracked: sourceCount,
        quality_score: qualityScore
      },
      profiles_updated: learnings.profiles_updated,
      source_reliability: learnings.source_reliability,
      recommendations,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Learning] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
