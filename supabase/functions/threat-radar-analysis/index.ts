import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getAntiHallucinationPrompt, getCriticalDateContext, categorizeIncidentsByAge } from "../_shared/anti-hallucination.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ThreatRadarRequest {
  client_id?: string;
  timeframe_hours?: number;
  focus_areas?: string[];
  include_predictions?: boolean;
  generate_snapshot?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      client_id, 
      timeframe_hours = 168, // Default 7 days
      focus_areas = ['radical_activity', 'sentiment', 'precursors', 'infrastructure'],
      include_predictions = true,
      generate_snapshot = true
    }: ThreatRadarRequest = await req.json();

    console.log('Threat Radar Analysis:', { client_id, timeframe_hours, focus_areas });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const timeframeCutoff = new Date(Date.now() - timeframe_hours * 60 * 60 * 1000).toISOString();

    // Gather comprehensive intelligence data
    const [
      signalsResult,
      incidentsResult,
      entitiesResult,
      entityMentionsResult,
      assetsResult,
      clientResult,
      existingPrecursorsResult,
      existingSentimentResult,
      existingRadicalResult
    ] = await Promise.all([
      // Recent signals with emphasis on threat-related
      supabaseClient
        .from('signals')
        .select('id, normalized_text, rule_category, rule_tags, signal_type, rule_priority, severity, confidence, created_at, location')
        .gte('created_at', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(500),
      
      // Recent incidents
      supabaseClient
        .from('incidents')
        .select('id, title, summary, priority, status, incident_type, severity_level, created_at')
        .gte('created_at', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(100),
      
      // High-threat entities
      supabaseClient
        .from('entities')
        .select('id, name, type, threat_score, risk_level, threat_indicators, active_monitoring_enabled, current_location')
        .or('threat_score.gte.50,risk_level.eq.high,risk_level.eq.critical')
        .eq('is_active', true)
        .limit(100),
      
      // Recent entity mentions
      supabaseClient
        .from('entity_mentions')
        .select('id, entity_id, confidence, context, detected_at, signal_id')
        .gte('detected_at', timeframeCutoff)
        .order('detected_at', { ascending: false })
        .limit(200),
      
      // Critical infrastructure assets
      supabaseClient
        .from('internal_assets')
        .select('id, asset_name, asset_type, business_criticality, location, is_internet_facing, owner_team')
        .or('business_criticality.eq.mission_critical,business_criticality.eq.high')
        .eq('is_active', true)
        .limit(100),
      
      // Client context if provided
      client_id ? supabaseClient
        .from('clients')
        .select('id, name, industry, high_value_assets, locations, threat_profile, monitoring_keywords')
        .eq('id', client_id)
        .single() : Promise.resolve({ data: null }),
      
      // Existing precursor indicators
      supabaseClient
        .from('threat_precursor_indicators')
        .select('*')
        .eq('status', 'active')
        .gte('last_activity_at', timeframeCutoff)
        .limit(50),
      
      // Existing sentiment tracking
      supabaseClient
        .from('sentiment_tracking')
        .select('*')
        .gte('measurement_period_end', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(50),
      
      // Existing radical activity
      supabaseClient
        .from('radical_activity_tracking')
        .select('*')
        .in('status', ['new', 'monitoring', 'escalated'])
        .gte('last_updated_at', timeframeCutoff)
        .limit(50)
    ]);

    const signals = signalsResult.data || [];
    const incidents = incidentsResult.data || [];
    const highThreatEntities = entitiesResult.data || [];
    const entityMentions = entityMentionsResult.data || [];
    const criticalAssets = assetsResult.data || [];
    const client = clientResult.data;
    const existingPrecursors = existingPrecursorsResult.data || [];
    const existingSentiment = existingSentimentResult.data || [];
    const existingRadical = existingRadicalResult.data || [];

    // Categorize signals by source and type
    const signalsBySource: Record<string, any[]> = {};
    const signalsByCategory: Record<string, any[]> = {};
    const signalsBySeverity: Record<string, any[]> = {};
    const geoSignals: any[] = [];

    signals.forEach((signal: any) => {
      const source = signal.signal_type || 'unknown';
      const category = signal.rule_category || 'uncategorized';
      const severity = signal.severity || 'medium';

      if (!signalsBySource[source]) signalsBySource[source] = [];
      signalsBySource[source].push(signal);

      if (!signalsByCategory[category]) signalsByCategory[category] = [];
      signalsByCategory[category].push(signal);

      if (!signalsBySeverity[severity]) signalsBySeverity[severity] = [];
      signalsBySeverity[severity].push(signal);

      // Check if location contains geo coordinates
      if (signal.location) {
        geoSignals.push(signal);
      }
    });

    // Calculate threat metrics
    const radicalSignals = signals.filter((s: any) => 
      s.rule_tags?.some((t: string) => ['extremism', 'radical', 'terrorism', 'sabotage', 'threat'].includes(t?.toLowerCase())) ||
      s.rule_category?.toLowerCase().includes('radical') ||
      s.normalized_text?.toLowerCase().includes('sabotage') ||
      s.normalized_text?.toLowerCase().includes('attack')
    );

    const darkWebSignals = signalsBySource['darkweb'] || signalsBySource['dark_web'] || [];
    const socialSignals = signalsBySource['social'] || signalsBySource['social_media'] || signalsBySource['twitter'] || [];
    const infrastructureSignals = signals.filter((s: any) => 
      s.rule_tags?.some((t: string) => ['infrastructure', 'energy', 'communication', 'tower', 'pipeline'].includes(t?.toLowerCase())) ||
      s.normalized_text?.toLowerCase().includes('infrastructure') ||
      s.normalized_text?.toLowerCase().includes('tower') ||
      s.normalized_text?.toLowerCase().includes('pipeline')
    );

    // Calculate scores (0-100)
    const radicalActivityScore = Math.min(100, Math.round(
      (radicalSignals.length * 10) + 
      (darkWebSignals.length * 15) + 
      (existingRadical.filter((r: any) => r.threat_level === 'high' || r.threat_level === 'critical').length * 20)
    ));

    const sentimentVolatilityScore = Math.min(100, Math.round(
      existingSentiment.reduce((acc: number, s: any) => acc + (s.sentiment_volatility || 0) * 50, 0) / Math.max(1, existingSentiment.length) +
      (socialSignals.filter((s: any) => s.severity === 'high' || s.severity === 'critical').length * 10)
    ));

    const precursorActivityScore = Math.min(100, Math.round(
      (existingPrecursors.length * 15) +
      (existingPrecursors.filter((p: any) => p.severity_level === 'critical' || p.severity_level === 'high').length * 25)
    ));

    const infrastructureRiskScore = Math.min(100, Math.round(
      (infrastructureSignals.length * 8) +
      (incidents.filter((i: any) => i.incident_type?.toLowerCase().includes('infrastructure')).length * 25) +
      (criticalAssets.filter((a: any) => a.is_internet_facing).length * 5)
    ));

    // Calculate overall threat score
    const overallThreatScore = Math.round(
      (radicalActivityScore * 0.3) +
      (sentimentVolatilityScore * 0.2) +
      (precursorActivityScore * 0.25) +
      (infrastructureRiskScore * 0.25)
    );

    // Determine threat level
    let overallThreatLevel = 'low';
    if (overallThreatScore >= 80) overallThreatLevel = 'critical';
    else if (overallThreatScore >= 60) overallThreatLevel = 'high';
    else if (overallThreatScore >= 40) overallThreatLevel = 'elevated';
    else if (overallThreatScore >= 20) overallThreatLevel = 'moderate';

    // Generate AI analysis for predictions
    let aiAnalysis = '';
    let predictions: any = null;

    if (include_predictions) {
      const dateContext = getCriticalDateContext();
      const antiHallucinationBlock = getAntiHallucinationPrompt();
      
      // Categorize incidents by age for accurate reporting
      const categorizedIncidents = categorizeIncidentsByAge(incidents as any);
      
      const analysisPrompt = `Analyze this threat intelligence data and provide predictive insights:

${antiHallucinationBlock}

=== VERIFIED DATA CONTEXT (as of ${dateContext.currentDateTimeISO}) ===

THREAT LANDSCAPE SUMMARY:
- Overall Threat Score: ${overallThreatScore}/100 (${overallThreatLevel})
- Radical Activity Score: ${radicalActivityScore}/100
- Sentiment Volatility Score: ${sentimentVolatilityScore}/100
- Precursor Activity Score: ${precursorActivityScore}/100
- Infrastructure Risk Score: ${infrastructureRiskScore}/100

SIGNAL INTELLIGENCE (EXACT COUNT: ${signals.length} signals in ${timeframe_hours} hours):
- Dark web signals: ${darkWebSignals.length}
- Social media signals: ${socialSignals.length}
- Radical/extremist signals: ${radicalSignals.length}
- Infrastructure-related signals: ${infrastructureSignals.length}
- Critical/high priority: ${(signalsBySeverity['critical']?.length || 0) + (signalsBySeverity['high']?.length || 0)}

HIGH-THREAT ENTITIES (EXACT COUNT: ${highThreatEntities.length}):
${highThreatEntities.slice(0, 5).map((e: any) => `- ${e.name} (${e.type}): threat_score ${e.threat_score}, indicators: ${e.threat_indicators?.join(', ')}`).join('\n')}

ACTIVE PRECURSOR INDICATORS (EXACT COUNT: ${existingPrecursors.length}):
${existingPrecursors.slice(0, 5).map((p: any) => `- ${p.indicator_name}: ${p.threat_category} targeting ${p.target_type} (${p.severity_level})`).join('\n')}

CRITICAL INFRASTRUCTURE AT RISK (EXACT COUNT: ${criticalAssets.length} assets):
${criticalAssets.slice(0, 5).map((a: any) => `- ${a.asset_name} (${a.asset_type}): ${a.business_criticality} criticality`).join('\n')}

INCIDENTS BREAKDOWN:
- ${categorizedIncidents.summary}
- New (last 24h): ${categorizedIncidents.newLast24h.length}
- Stale (>7 days): ${categorizedIncidents.stale.length + categorizedIncidents.veryStale.length}
P1/P2 Incidents:
${incidents.filter((i: any) => i.priority === 'P1' || i.priority === 'P2').slice(0, 5).map((i: any) => `- ${i.title}: ${i.status} (${i.priority}) - opened ${i.created_at}`).join('\n')}

${client ? `CLIENT CONTEXT: ${client.name} (${client.industry})\nHigh-value assets: ${client.high_value_assets?.join(', ')}\nLocations: ${client.locations?.join(', ')}` : ''}

=== END VERIFIED DATA ===

CRITICAL: Use ONLY the exact counts and dates provided above. Never approximate or guess.

Provide:
1. THREAT FORECAST: What threats are most likely to materialize in the next 24-72 hours? (cite data)
2. ATTACK VECTOR PREDICTION: Most probable attack methods based on current indicators (cite specific indicators)
3. TARGET PREDICTION: Which assets/locations are at highest risk? (cite threat scores)
4. ESCALATION PROBABILITY: % chance of threat escalation (0-100) with timeline and reasoning
5. RECOMMENDED PREEMPTIVE ACTIONS: Top 5 specific actions to take NOW
6. KEY INDICATORS TO MONITOR: What should analysts watch for?

Be specific, actionable, and ALWAYS cite the data source for each claim.`;

      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { 
                role: 'system', 
                content: `You are an elite threat intelligence analyst specializing in predictive threat analysis for critical infrastructure protection. 

CRITICAL ACCURACY RULES:
1. ONLY use exact numbers provided in the data - NEVER approximate or round
2. ONLY reference dates that appear in the data - NEVER fabricate dates
3. Distinguish between NEW incidents (last 24h) and STALE incidents (>7 days old)
4. Cite your data source for every claim (e.g., "Based on the 4 active precursor indicators...")
5. If information is missing, explicitly state "Data not available" rather than guessing
6. Use hedged language for predictions: "Based on current indicators, there is a [X]% probability..."

Provide concise, actionable intelligence assessments focused on proactive threat neutralization.` 
              },
              { role: 'user', content: analysisPrompt }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          aiAnalysis = aiData.choices?.[0]?.message?.content || '';

          // Extract escalation probability from AI response
          const probMatch = aiAnalysis.match(/(\d{1,3})%?\s*(?:chance|probability)/i);
          const escalationProbability = probMatch ? parseInt(probMatch[1]) : overallThreatScore;

          predictions = {
            escalation_probability: Math.min(100, escalationProbability),
            predicted_timeframe: overallThreatScore >= 60 ? 'days' : overallThreatScore >= 40 ? 'weeks' : 'months',
            confidence_level: overallThreatScore >= 50 ? 'high' : overallThreatScore >= 30 ? 'medium' : 'low',
            ai_assessment: aiAnalysis
          };
        }
      } catch (aiError) {
        console.error('AI analysis error:', aiError);
      }
    }

    // Generate snapshot if requested
    let snapshotId = null;
    if (generate_snapshot) {
      const keyIndicators = [
        ...radicalSignals.slice(0, 5).map((s: any) => ({
          type: 'radical_signal',
          title: s.normalized_text?.substring(0, 100),
          severity: s.severity,
          source: s.source_type
        })),
        ...existingPrecursors.slice(0, 5).map((p: any) => ({
          type: 'precursor',
          title: p.indicator_name,
          severity: p.severity_level,
          category: p.threat_category
        }))
      ];

      const recommendedActions = [];
      if (radicalActivityScore >= 50) {
        recommendedActions.push({ action: 'Increase monitoring of dark web channels', priority: 'high' });
      }
      if (infrastructureRiskScore >= 50) {
        recommendedActions.push({ action: 'Deploy additional physical security to critical assets', priority: 'high' });
      }
      if (sentimentVolatilityScore >= 50) {
        recommendedActions.push({ action: 'Activate social media monitoring surge', priority: 'medium' });
      }
      if (precursorActivityScore >= 50) {
        recommendedActions.push({ action: 'Brief executive leadership on emerging threats', priority: 'high' });
      }

      const { data: snapshot, error: snapshotError } = await supabaseClient
        .from('threat_radar_snapshots')
        .insert({
          client_id,
          snapshot_type: 'automatic',
          overall_threat_level: overallThreatLevel,
          threat_score: overallThreatScore,
          radical_activity_score: radicalActivityScore,
          sentiment_volatility_score: sentimentVolatilityScore,
          precursor_activity_score: precursorActivityScore,
          infrastructure_risk_score: infrastructureRiskScore,
          radical_mentions_count: radicalSignals.length,
          sentiment_shift_detected: sentimentVolatilityScore >= 40,
          precursor_patterns_detected: existingPrecursors.length,
          critical_assets_at_risk: criticalAssets.slice(0, 10).map((a: any) => a.asset_name),
          predicted_escalation_probability: predictions?.escalation_probability || overallThreatScore,
          predicted_timeline_hours: predictions?.predicted_timeframe === 'days' ? 72 : predictions?.predicted_timeframe === 'weeks' ? 168 : 720,
          key_indicators: keyIndicators,
          recommended_actions: recommendedActions,
          data_sources: Object.keys(signalsBySource),
          ai_analysis_summary: aiAnalysis?.substring(0, 2000)
        })
        .select('id')
        .single();

      if (snapshot) {
        snapshotId = snapshot.id;
      }
    }

    // Build response
    const response = {
      timestamp: new Date().toISOString(),
      timeframe_hours,
      client_id,
      snapshot_id: snapshotId,
      
      // Overall assessment
      threat_assessment: {
        overall_level: overallThreatLevel,
        overall_score: overallThreatScore,
        scores: {
          radical_activity: radicalActivityScore,
          sentiment_volatility: sentimentVolatilityScore,
          precursor_activity: precursorActivityScore,
          infrastructure_risk: infrastructureRiskScore
        }
      },

      // Intelligence summary
      intelligence_summary: {
        total_signals: signals.length,
        signals_by_source: Object.fromEntries(Object.entries(signalsBySource).map(([k, v]) => [k, v.length])),
        signals_by_severity: Object.fromEntries(Object.entries(signalsBySeverity).map(([k, v]) => [k, v.length])),
        dark_web_signals: darkWebSignals.length,
        social_media_signals: socialSignals.length,
        radical_signals: radicalSignals.length,
        infrastructure_signals: infrastructureSignals.length,
        geo_located_signals: geoSignals.length
      },

      // High-threat items
      high_threat_entities: highThreatEntities.slice(0, 10),
      active_precursors: existingPrecursors.slice(0, 10),
      critical_assets: criticalAssets.slice(0, 10),
      recent_incidents: incidents.filter((i: any) => i.priority === 'P1' || i.priority === 'P2').slice(0, 5),

      // Geo-intelligence
      geo_intelligence: {
        geo_signals_count: geoSignals.length,
        hotspots: geoSignals.slice(0, 20).map((s: any) => ({
          location: s.location,
          severity: s.severity,
          category: s.rule_category
        }))
      },

      // Predictions
      predictions,

      // Top alerts
      top_alerts: [
        ...radicalSignals.slice(0, 3).map((s: any) => ({
          type: 'radical_activity',
          title: s.normalized_text?.substring(0, 150),
          severity: s.severity,
          source: s.signal_type,
          created_at: s.created_at
        })),
        ...infrastructureSignals.slice(0, 3).map((s: any) => ({
          type: 'infrastructure_threat',
          title: s.normalized_text?.substring(0, 150),
          severity: s.severity,
          source: s.signal_type,
          created_at: s.created_at
        }))
      ]
    };

    console.log('Threat Radar Analysis complete:', {
      overall_score: overallThreatScore,
      overall_level: overallThreatLevel,
      signals_analyzed: signals.length
    });

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in threat-radar-analysis:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
