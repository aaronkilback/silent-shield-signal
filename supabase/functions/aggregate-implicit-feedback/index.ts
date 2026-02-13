import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Aggregate Implicit Feedback — Processes implicit_feedback_events into learning profiles.
 * Called periodically (pg_cron) or on-demand to close the loop between analyst behavior and AI learning.
 * 
 * Behavioral signals tracked:
 * - view_duration: long views → interest signal
 * - dismissed_quickly: quick dismissals → irrelevance signal  
 * - escalated: analyst escalated → high-value signal
 * - included_in_report: signal used in report → confirmed relevance
 * - investigated: deeper investigation → strong interest
 * - shared: shared with others → high value
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Get unprocessed implicit events from last 24h (or since last run)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: events, error } = await supabase
      .from('implicit_feedback_events')
      .select('id, signal_id, event_type, event_value, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) throw error;
    if (!events || events.length === 0) {
      return successResponse({ processed: 0, message: 'No implicit events to process' });
    }

    console.log(`Processing ${events.length} implicit feedback events`);

    // Aggregate by signal_id
    const signalStats = new Map<string, {
      totalViewTime: number;
      viewCount: number;
      dismissals: number;
      escalations: number;
      reportInclusions: number;
      investigations: number;
      shares: number;
    }>();

    for (const event of events) {
      if (!signalStats.has(event.signal_id)) {
        signalStats.set(event.signal_id, {
          totalViewTime: 0, viewCount: 0, dismissals: 0,
          escalations: 0, reportInclusions: 0, investigations: 0, shares: 0,
        });
      }
      const stats = signalStats.get(event.signal_id)!;

      switch (event.event_type) {
        case 'view_duration':
          stats.totalViewTime += event.event_value || 0;
          stats.viewCount++;
          break;
        case 'dismissed_quickly':
          stats.dismissals++;
          break;
        case 'escalated':
          stats.escalations++;
          break;
        case 'included_in_report':
          stats.reportInclusions++;
          break;
        case 'investigated':
          stats.investigations++;
          break;
        case 'shared':
          stats.shares++;
          break;
      }
    }

    // Fetch signal metadata for keyword extraction
    const signalIds = [...signalStats.keys()];
    const { data: signals } = await supabase
      .from('signals')
      .select('id, title, normalized_text, category, source_type, rule_category')
      .in('id', signalIds);

    const signalMap = new Map((signals || []).map(s => [s.id, s]));

    // Build learning profile updates
    const engagedFeatures: Record<string, number> = {};
    const dismissedFeatures: Record<string, number> = {};
    const behavioralMetrics: Record<string, number> = {
      total_implicit_events: events.length,
      signals_analyzed: signalStats.size,
    };

    for (const [signalId, stats] of signalStats) {
      const signal = signalMap.get(signalId);
      if (!signal) continue;

      const text = `${signal.title || ''} ${signal.normalized_text || ''}`.toLowerCase();
      const keywords = extractKeywords(text);
      const category = signal.rule_category || signal.category;

      // Compute engagement score: escalation=5, report=4, investigate=3, share=3, long_view=1, dismiss=-2
      const engagementScore = 
        stats.escalations * 5 +
        stats.reportInclusions * 4 +
        stats.investigations * 3 +
        stats.shares * 3 +
        (stats.totalViewTime > 30 ? 1 : 0) -
        stats.dismissals * 2;

      const target = engagementScore > 0 ? engagedFeatures : dismissedFeatures;
      const weight = Math.abs(engagementScore);

      for (const [kw, _] of Object.entries(keywords)) {
        target[kw] = (target[kw] || 0) + weight;
      }

      if (category) {
        target[`category:${category}`] = (target[`category:${category}`] || 0) + weight;
      }
      if (signal.source_type) {
        target[`source:${signal.source_type}`] = (target[`source:${signal.source_type}`] || 0) + weight;
      }

      // Track behavioral patterns
      if (stats.escalations > 0) behavioralMetrics.total_escalations = (behavioralMetrics.total_escalations || 0) + stats.escalations;
      if (stats.reportInclusions > 0) behavioralMetrics.total_report_inclusions = (behavioralMetrics.total_report_inclusions || 0) + stats.reportInclusions;
      if (stats.dismissals > 0) behavioralMetrics.total_quick_dismissals = (behavioralMetrics.total_quick_dismissals || 0) + stats.dismissals;
      if (stats.investigations > 0) behavioralMetrics.total_investigations = (behavioralMetrics.total_investigations || 0) + stats.investigations;
      behavioralMetrics.avg_view_time = stats.viewCount > 0 
        ? Math.round(stats.totalViewTime / stats.viewCount) 
        : (behavioralMetrics.avg_view_time || 0);
    }

    // Upsert learning profiles
    const upserts: Promise<void>[] = [];

    if (Object.keys(engagedFeatures).length > 0) {
      upserts.push(upsertProfile(supabase, 'implicit_engaged_patterns', engagedFeatures));
    }
    if (Object.keys(dismissedFeatures).length > 0) {
      upserts.push(upsertProfile(supabase, 'implicit_dismissed_patterns', dismissedFeatures));
    }
    upserts.push(upsertProfile(supabase, 'implicit_behavioral_metrics', behavioralMetrics));

    await Promise.all(upserts);

    console.log(`Aggregated ${events.length} implicit events → ${signalStats.size} signals analyzed`);

    return successResponse({
      processed: events.length,
      signals_analyzed: signalStats.size,
      engaged_keywords: Object.keys(engagedFeatures).length,
      dismissed_keywords: Object.keys(dismissedFeatures).length,
    });

  } catch (error) {
    console.error('Error in aggregate-implicit-feedback:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

function extractKeywords(text: string): Record<string, number> {
  const words = text.split(/\s+/).filter(w => w.length > 3);
  const features: Record<string, number> = {};
  [...new Set(words)].slice(0, 20).forEach(kw => { features[kw] = 1; });
  return features;
}

async function upsertProfile(
  supabase: ReturnType<typeof createServiceClient>,
  profileType: string,
  newFeatures: Record<string, number>
) {
  try {
    const { data: existing } = await supabase
      .from('learning_profiles')
      .select('*')
      .eq('profile_type', profileType)
      .single();

    if (existing) {
      const currentFeatures = (existing.features as Record<string, number>) || {};
      Object.entries(newFeatures).forEach(([key, value]) => {
        currentFeatures[key] = (currentFeatures[key] || 0) + value;
      });
      await supabase.from('learning_profiles').update({
        features: currentFeatures,
        sample_count: ((existing.sample_count as number) || 0) + 1,
        last_updated: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_profiles').insert({
        profile_type: profileType,
        features: newFeatures,
        sample_count: 1,
      });
    }
  } catch (error) {
    console.error(`Error upserting profile ${profileType}:`, error instanceof Error ? error.message : error);
  }
}
