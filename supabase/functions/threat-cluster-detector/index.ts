/**
 * Threat Cluster Detector
 * 
 * Proactive pre-incident pattern detection. Analyzes signal velocity
 * by category/region — when 3+ related signals arrive within 2 hours,
 * auto-generates a "Threat Cluster Alert" before it becomes an incident.
 * 
 * Also implements smart suppression decay: auto-reduces suppression
 * weights on patterns not seen in 30+ days.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface SignalRecord {
  id: string;
  category: string | null;
  location: string | null;
  severity: string | null;
  normalized_text: string | null;
  entity_tags: string[] | null;
  created_at: string;
  client_id: string | null;
  signal_type?: string | null;
}

interface ClusterAlert {
  cluster_type: 'category_surge' | 'geographic_surge' | 'entity_surge' | 'cross_domain';
  key: string;
  signal_count: number;
  signal_ids: string[];
  window_hours: number;
  severity_breakdown: Record<string, number>;
  first_seen: string;
  last_seen: string;
  risk_score: number;
  description: string;
}

// Categories that belong together — only signals within the same affinity group
// should form geographic clusters, and cross-domain only fires across different groups.
const CATEGORY_AFFINITY: Record<string, string> = {
  protest:         'civil_unrest',
  civil_emergency: 'civil_unrest',
  social_sentiment:'civil_unrest',
  violence:        'civil_unrest',
  active_threat:   'physical_threat',
  physical:        'physical_threat',
  amber_alert:     'physical_threat',
  insider_threat:  'insider',
  surveillance:    'insider',
  cybersecurity:   'cyber',
  malware:         'cyber',
  operational:     'operational',
  regulatory:      'operational',
  compliance:      'operational',
  advisory:        'operational',
  system_alert:    'operational',
  environmental:   'environmental',
  health_concern:  'environmental',
  other:           'other',
};

function affinityGroup(category: string | null): string {
  return CATEGORY_AFFINITY[category || ''] || 'other';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    console.log('[ClusterDetector] Starting proactive threat cluster scan...');

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Fetch recent signals (last 6 hours for velocity)
    // ═══════════════════════════════════════════════════════════
    
    const cutoff6h = new Date(Date.now() - 6 * 3600000).toISOString();
    const cutoff4h = new Date(Date.now() - 4 * 3600000).toISOString();

    const { data: recentSignals, error: sigErr } = await supabase
      .from('signals')
      .select('id, category, location, severity, normalized_text, entity_tags, created_at, client_id')
      .gte('created_at', cutoff6h)
      .order('created_at', { ascending: false })
      .limit(500);

    if (sigErr) throw new Error(`Signal query failed: ${sigErr.message}`);

    const signals = (recentSignals || []) as SignalRecord[];
    console.log(`[ClusterDetector] Analyzing ${signals.length} signals from last 6 hours`);

    const clusters: ClusterAlert[] = [];

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Category velocity detection
    // ═══════════════════════════════════════════════════════════

    const categoryBuckets = new Map<string, SignalRecord[]>();
    for (const sig of signals) {
      const cat = sig.category || 'uncategorized';
      if (!categoryBuckets.has(cat)) categoryBuckets.set(cat, []);
      categoryBuckets.get(cat)!.push(sig);
    }

    for (const [category, catSignals] of categoryBuckets.entries()) {
      // Check 4-hour window velocity
      const recentWindow = catSignals.filter(s => s.created_at >= cutoff4h);
      if (recentWindow.length >= 5) {
        const sevBreakdown: Record<string, number> = {};
        recentWindow.forEach(s => {
          const sev = s.severity || 'unknown';
          sevBreakdown[sev] = (sevBreakdown[sev] || 0) + 1;
        });

        const highSevCount = (sevBreakdown['critical'] || 0) + (sevBreakdown['high'] || 0);
        const riskScore = Math.min(100, Math.round(
          recentWindow.length * 12 +
          highSevCount * 20 +
          (recentWindow.length >= 5 ? 20 : 0)
        ));

        const prior2h = catSignals.filter(s => s.created_at < cutoff4h).length;
        const isEscalating = recentWindow.length > prior2h;
        clusters.push({
          cluster_type: 'category_surge',
          key: category,
          signal_count: recentWindow.length,
          signal_ids: recentWindow.map(s => s.id),
          window_hours: 4,
          severity_breakdown: sevBreakdown,
          first_seen: recentWindow[recentWindow.length - 1].created_at,
          last_seen: recentWindow[0].created_at,
          risk_score: riskScore,
          description: `Threat type cluster: ${recentWindow.length} "${category}" signals in 4-hour window (${highSevCount} high/critical). Trajectory: ${isEscalating ? 'ESCALATING — rate increased vs prior period' : 'STABLE — consistent with baseline'}. This surge warrants review for coordinated activity or developing campaign.`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Geographic velocity detection
    // ═══════════════════════════════════════════════════════════

    // Bucket by location + affinity group so unlike categories (protest vs theft) don't merge
    const locationBuckets = new Map<string, SignalRecord[]>();
    for (const sig of signals) {
      const loc = (sig.location || '').trim().toLowerCase();
      if (!loc || loc === 'unknown' || loc.length < 3) continue;
      const skipPatterns = ['b.c.', 'bc', 'ontario', 'alberta', 'quebec', 'canada', 'usa', 'united states'];
      if (skipPatterns.includes(loc)) continue;
      const group = affinityGroup(sig.category);
      const key = `${loc}::${group}`;
      if (!locationBuckets.has(key)) locationBuckets.set(key, []);
      locationBuckets.get(key)!.push(sig);
    }

    for (const [bucketKey, locSignals] of locationBuckets.entries()) {
      const [location, group] = bucketKey.split('::');
      const recentWindow = locSignals.filter(s => s.created_at >= cutoff4h);
      if (recentWindow.length >= 5) {
        const categories = new Set(recentWindow.map(s => s.category || 'unknown'));
        const sevBreakdown: Record<string, number> = {};
        recentWindow.forEach(s => {
          const sev = s.severity || 'unknown';
          sevBreakdown[sev] = (sevBreakdown[sev] || 0) + 1;
        });

        const riskScore = Math.min(100, Math.round(
          recentWindow.length * 10 +
          categories.size * 15 +
          ((sevBreakdown['critical'] || 0) + (sevBreakdown['high'] || 0)) * 15
        ));

        const typeBreakdown = [...categories].join(', ');
        const priorWindow = locSignals.filter(s => s.created_at < cutoff4h).length;
        const isEscalating = recentWindow.length > priorWindow;
        clusters.push({
          cluster_type: 'geographic_surge',
          key: `${location}:${group}`,
          signal_count: recentWindow.length,
          signal_ids: recentWindow.map(s => s.id),
          window_hours: 4,
          severity_breakdown: sevBreakdown,
          first_seen: recentWindow[recentWindow.length - 1].created_at,
          last_seen: recentWindow[0].created_at,
          risk_score: riskScore,
          description: `Geographic cluster detected: ${recentWindow.length} ${group} signals concentrated near ${location} within 4 hours. Signal types: ${typeBreakdown}. Trajectory: ${isEscalating ? 'ESCALATING — count increased from previous period' : 'STABLE — consistent with baseline activity'}. This concentration warrants review for coordinated activity or developing situation.`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Entity surge detection
    // ═══════════════════════════════════════════════════════════

    const entityBuckets = new Map<string, SignalRecord[]>();
    for (const sig of signals) {
      for (const tag of (sig.entity_tags || [])) {
        const normalized = tag.toLowerCase().trim();
        if (normalized.length < 3) continue;
        if (!entityBuckets.has(normalized)) entityBuckets.set(normalized, []);
        entityBuckets.get(normalized)!.push(sig);
      }
    }

    for (const [entity, entSignals] of entityBuckets.entries()) {
      const recentWindow = entSignals.filter(s => s.created_at >= cutoff4h);
      if (recentWindow.length >= 5) {
        const sevBreakdown: Record<string, number> = {};
        recentWindow.forEach(s => {
          const sev = s.severity || 'unknown';
          sevBreakdown[sev] = (sevBreakdown[sev] || 0) + 1;
        });

        const highSevCount = (sevBreakdown['critical'] || 0) + (sevBreakdown['high'] || 0);
        const priorWindow = entSignals.filter(s => s.created_at < cutoff4h).length;
        const isEscalating = recentWindow.length > priorWindow;
        clusters.push({
          cluster_type: 'entity_surge',
          key: entity,
          signal_count: recentWindow.length,
          signal_ids: recentWindow.map(s => s.id),
          window_hours: 4,
          severity_breakdown: sevBreakdown,
          first_seen: recentWindow[recentWindow.length - 1].created_at,
          last_seen: recentWindow[0].created_at,
          risk_score: Math.min(100, recentWindow.length * 15 + highSevCount * 20),
          description: `Entity surge: "${entity}" mentioned in ${recentWindow.length} signals within 4 hours (${highSevCount} high/critical). Trajectory: ${isEscalating ? 'ESCALATING — mentions accelerating' : 'STABLE — consistent mention rate'}. Elevated entity attention may indicate targeted campaign or emerging incident.`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: Cross-domain pattern detection
    // ═══════════════════════════════════════════════════════════

    // Cross-domain fires only when signals span 3+ DISTINCT affinity groups in same location.
    // protest + civil_emergency = same group (civil_unrest) — NOT cross-domain.
    // civil_unrest + cyber + operational in one place = genuinely cross-domain.
    const crossDomainMap = new Map<string, Set<string>>(); // loc → Set<affinityGroup>
    const crossDomainCats = new Map<string, Set<string>>(); // loc → Set<category>
    for (const sig of signals.filter(s => s.created_at >= cutoff4h)) {
      const loc = (sig.location || '').trim().toLowerCase();
      if (!loc || loc.length < 3) continue;
      if (!crossDomainMap.has(loc)) {
        crossDomainMap.set(loc, new Set());
        crossDomainCats.set(loc, new Set());
      }
      crossDomainMap.get(loc)!.add(affinityGroup(sig.category));
      crossDomainCats.get(loc)!.add(sig.category || 'unknown');
    }

    for (const [location, affinityGroups] of crossDomainMap.entries()) {
      if (affinityGroups.size >= 3) {
        const locSignals = signals.filter(s =>
          (s.location || '').trim().toLowerCase() === location &&
          s.created_at >= cutoff4h
        );
        const cats = [...(crossDomainCats.get(location) || [])];
        clusters.push({
          cluster_type: 'cross_domain',
          key: `${location}:${[...affinityGroups].join('+')}`,
          signal_count: locSignals.length,
          signal_ids: locSignals.map(s => s.id),
          window_hours: 4,
          severity_breakdown: {},
          first_seen: locSignals[locSignals.length - 1]?.created_at || '',
          last_seen: locSignals[0]?.created_at || '',
          risk_score: Math.min(100, affinityGroups.size * 20 + locSignals.length * 8),
          description: `Cross-domain convergence in "${location}": ${cats.join(', ')} spanning ${affinityGroups.size} distinct threat domains (${locSignals.length} signals)`,
        });
      }
    }

    // Sort clusters by risk
    clusters.sort((a, b) => b.risk_score - a.risk_score);

    // ═══════════════════════════════════════════════════════════
    // PHASE 6: Generate AI threat assessment for high-risk clusters
    // ═══════════════════════════════════════════════════════════

    let aiAssessment: string | null = null;
    const highRiskClusters = clusters.filter(c => c.risk_score >= 60);

    if (highRiskClusters.length > 0) {
      try {
        const clusterSummary = highRiskClusters.slice(0, 5).map((c, i) => 
          `${i + 1}. [${c.cluster_type.toUpperCase()}] ${c.description} — Risk: ${c.risk_score}/100`
        ).join('\n');

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a senior intelligence analyst performing real-time threat cluster analysis. Identify the most likely threat to materialize within 4 hours based on signal convergence patterns. Be precise, measured, and actionable. Max 120 words.',
              },
              {
                role: 'user',
                content: `ACTIVE THREAT CLUSTERS detected in the last 4 hours:\n${clusterSummary}\n\nAssess: What is the most probable emerging threat? What immediate action should the SOC take?`,
              },
            ],
            max_tokens: 400,
            temperature: 0.2,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          aiAssessment = data.choices?.[0]?.message?.content || null;
        }
      } catch (e) {
        console.error('[ClusterDetector] AI assessment error:', e);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 7: Store cluster alerts
    // ═══════════════════════════════════════════════════════════

    if (highRiskClusters.length > 0) {
      await supabase.from('autonomous_scan_results').insert({
        agent_call_sign: 'CLUSTER-DETECTOR',
        scan_type: 'threat_cluster_detection',
        findings: {
          clusters: highRiskClusters,
          ai_assessment: aiAssessment,
          total_signals_analyzed: signals.length,
        },
        risk_score: highRiskClusters[0]?.risk_score || 0,
        signals_analyzed: signals.length,
        alerts_generated: highRiskClusters.length,
        status: 'completed',
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 8: Smart suppression decay
    // ═══════════════════════════════════════════════════════════

    const { data: learningProfiles } = await supabase
      .from('learning_profiles')
      .select('id, profile_type, features, last_updated')
      .like('profile_type', 'rejected_%');

    let decayActions = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    for (const profile of (learningProfiles || [])) {
      if (profile.last_updated && profile.last_updated < thirtyDaysAgo) {
        // Decay: reduce all feature weights by 30%
        const features = (profile.features as Record<string, number>) || {};
        const decayedFeatures: Record<string, number> = {};
        let anySignificant = false;
        
        for (const [key, value] of Object.entries(features)) {
          const decayed = typeof value === 'number' ? value * 0.7 : value;
          if (typeof decayed === 'number' && decayed > 0.1) {
            decayedFeatures[key] = Math.round(decayed * 100) / 100;
            anySignificant = true;
          }
          // Drop features that decayed below 0.1
        }

        if (anySignificant) {
          await supabase.from('learning_profiles').update({
            features: decayedFeatures,
            last_updated: new Date().toISOString(),
          }).eq('id', profile.id);
          decayActions++;
        }
      }
    }

    console.log(`[ClusterDetector] Complete: ${clusters.length} clusters detected (${highRiskClusters.length} high-risk), ${decayActions} suppression profiles decayed`);

    return successResponse({
      success: true,
      total_signals_analyzed: signals.length,
      clusters_detected: clusters.length,
      high_risk_clusters: highRiskClusters.length,
      clusters: clusters.slice(0, 20),
      ai_assessment: aiAssessment,
      suppression_decay_actions: decayActions,
      generated_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[ClusterDetector] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
