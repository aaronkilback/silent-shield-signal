import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, categorizeIncidentsByAge } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface ThreatRadarRequest {
  client_id?: string;
  timeframe_hours?: number;
  focus_areas?: string[];
  include_predictions?: boolean;
  generate_snapshot?: boolean;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    
    // Health check endpoint for pipeline tests
    if (body.health_check) {
      return successResponse({ 
        status: 'healthy', 
        function: 'threat-radar-analysis',
        timestamp: new Date().toISOString() 
      });
    }
    
    const { 
      client_id, 
      timeframe_hours = 168, // Default 7 days
      focus_areas = ['radical_activity', 'sentiment', 'precursors', 'infrastructure'],
      include_predictions = true,
      generate_snapshot = true
    }: ThreatRadarRequest = body;

    console.log('Threat Radar Analysis:', { client_id, timeframe_hours, focus_areas });

    const supabase = createServiceClient();

    // GEMINI_API_KEY handled by callAiGateway

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
      supabase
        .from('signals')
        .select('id, normalized_text, rule_category, rule_tags, signal_type, rule_priority, severity, confidence, created_at, location')
        .gte('created_at', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(500),
      
      // Recent incidents
      supabase
        .from('incidents')
        .select('id, title, summary, priority, status, incident_type, severity_level, created_at')
        .gte('created_at', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(100),
      
      // High-threat entities
      supabase
        .from('entities')
        .select('id, name, type, threat_score, risk_level, threat_indicators, active_monitoring_enabled, current_location')
        .or('threat_score.gte.50,risk_level.eq.high,risk_level.eq.critical')
        .eq('is_active', true)
        .limit(100),
      
      // Recent entity mentions
      supabase
        .from('entity_mentions')
        .select('id, entity_id, confidence, context, detected_at, signal_id')
        .gte('detected_at', timeframeCutoff)
        .order('detected_at', { ascending: false })
        .limit(200),
      
      // Critical infrastructure assets
      supabase
        .from('internal_assets')
        .select('id, asset_name, asset_type, business_criticality, location, is_internet_facing, owner_team')
        .or('business_criticality.eq.mission_critical,business_criticality.eq.high')
        .eq('is_active', true)
        .limit(100),
      
      // Client context if provided
      client_id ? supabase
        .from('clients')
        .select('id, name, industry, high_value_assets, locations, threat_profile, monitoring_keywords')
        .eq('id', client_id)
        .single() : Promise.resolve({ data: null }),
      
      // Existing precursor indicators
      supabase
        .from('threat_precursor_indicators')
        .select('*')
        .eq('status', 'active')
        .gte('last_activity_at', timeframeCutoff)
        .limit(50),
      
      // Existing sentiment tracking
      supabase
        .from('sentiment_tracking')
        .select('*')
        .gte('measurement_period_end', timeframeCutoff)
        .order('created_at', { ascending: false })
        .limit(50),
      
      // Existing radical activity
      supabase
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

    // =================================================================
    // IMPROVED THREAT SCORING - Based on signal intelligence, NOT incident counts
    // =================================================================

    // Calculate recency weight - recent signals matter more
    const now = Date.now();
    const getRecencyWeight = (dateStr: string): number => {
      const age = now - new Date(dateStr).getTime();
      const hoursOld = age / (1000 * 60 * 60);
      if (hoursOld < 24) return 1.0;      // Last 24h: full weight
      if (hoursOld < 72) return 0.7;      // 1-3 days: 70% weight
      if (hoursOld < 168) return 0.4;     // 3-7 days: 40% weight
      return 0.2;                          // Older: 20% weight
    };

    // Score signals by severity with recency weighting
    const severityWeight = { critical: 25, high: 15, medium: 5, low: 2, info: 1 };
    
    // Radical Activity: weighted by signal severity AND recency
    const radicalActivityScore = Math.min(100, Math.round(
      radicalSignals.reduce((acc: number, s: any) => {
        const weight = severityWeight[s.severity as keyof typeof severityWeight] || 5;
        const recency = getRecencyWeight(s.created_at);
        return acc + (weight * recency);
      }, 0) +
      (existingRadical.filter((r: any) => r.threat_level === 'high' || r.threat_level === 'critical').length * 10)
    ));

    // Sentiment Volatility: based on actual volatility metrics
    const sentimentVolatilityScore = Math.min(100, Math.round(
      existingSentiment.length > 0
        ? existingSentiment.reduce((acc: number, s: any) => acc + (s.sentiment_volatility || 0) * 100, 0) / existingSentiment.length
        : (socialSignals.filter((s: any) => s.severity === 'critical' || s.severity === 'high').length * 8)
    ));

    // Precursor Activity: PRIMARY driver of predictive threat assessment
    const precursorActivityScore = Math.min(100, Math.round(
      existingPrecursors.reduce((acc: number, p: any) => {
        const severityMult = p.severity_level === 'critical' ? 30 : p.severity_level === 'high' ? 20 : 10;
        const recency = getRecencyWeight(p.last_activity_at || p.created_at);
        return acc + (severityMult * recency);
      }, 0)
    ));

    // Infrastructure Risk: based on SIGNAL intelligence about infrastructure
    const infrastructureRiskScore = Math.min(100, Math.round(
      infrastructureSignals.reduce((acc: number, s: any) => {
        const weight = severityWeight[s.severity as keyof typeof severityWeight] || 5;
        const recency = getRecencyWeight(s.created_at);
        return acc + (weight * recency);
      }, 0) +
      (criticalAssets.filter((a: any) => a.is_internet_facing && a.business_criticality === 'mission_critical').length * 3)
    ));

    // Calculate overall threat score with BALANCED weights
    const overallThreatScore = Math.round(
      (radicalActivityScore * 0.25) +     // Radical signals: 25%
      (sentimentVolatilityScore * 0.15) + // Sentiment volatility: 15%
      (precursorActivityScore * 0.35) +   // Precursor indicators: 35% (LEADING)
      (infrastructureRiskScore * 0.25)    // Infrastructure signals: 25%
    );

    // Determine threat level with CONSERVATIVE thresholds
    let overallThreatLevel = 'low';
    if (overallThreatScore >= 75) overallThreatLevel = 'critical';
    else if (overallThreatScore >= 55) overallThreatLevel = 'high';
    else if (overallThreatScore >= 35) overallThreatLevel = 'elevated';
    else if (overallThreatScore >= 15) overallThreatLevel = 'moderate';

    // Calculate threat momentum
    const recentSignals = signals.filter((s: any) => getRecencyWeight(s.created_at) >= 0.7).length;
    const olderSignals = signals.filter((s: any) => getRecencyWeight(s.created_at) < 0.7).length;
    const threatMomentum = recentSignals > olderSignals * 1.5 ? 'rising' : 
                           recentSignals < olderSignals * 0.5 ? 'declining' : 'stable';

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
        const aiResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are an elite threat intelligence analyst specializing in predictive threat analysis for critical infrastructure protection. 

CRITICAL ACCURACY RULES:
1. ONLY use exact numbers provided in the data - NEVER approximate or round
2. ONLY reference dates that appear in the data - NEVER fabricate dates
3. Distinguish between NEW incidents (last 24h) and STALE incidents (>7 days old)
4. Cite your data source for every claim
5. If information is missing, explicitly state "Data not available" rather than guessing
6. Use hedged language for predictions

Provide concise, actionable intelligence assessments focused on proactive threat neutralization.` 
            },
            { role: 'user', content: analysisPrompt }
          ],
          functionName: 'threat-radar-analysis',
          dlqOnFailure: true,
          dlqPayload: { client_id, timeframe_hours },
        });

        if (aiResult.content) {
          aiAnalysis = aiResult.content;

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
          source: s.signal_type
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
        recommendedActions.push({ action: 'Review physical security at critical assets', priority: 'high' });
      }
      if (precursorActivityScore >= 40) {
        recommendedActions.push({ action: 'Deploy additional surveillance on active precursors', priority: 'medium' });
      }
      if (sentimentVolatilityScore >= 40) {
        recommendedActions.push({ action: 'Monitor social media sentiment trends', priority: 'medium' });
      }

      // Save snapshot
      const { data: snapshot, error: snapshotError } = await supabase
        .from('client_risk_snapshots')
        .insert({
          client_id: client_id || null,
          risk_score: overallThreatScore,
          snapshot_data: {
            threat_level: overallThreatLevel,
            scores: {
              radical_activity: radicalActivityScore,
              sentiment_volatility: sentimentVolatilityScore,
              precursor_activity: precursorActivityScore,
              infrastructure_risk: infrastructureRiskScore
            },
            momentum: threatMomentum,
            signal_counts: {
              total: signals.length,
              radical: radicalSignals.length,
              dark_web: darkWebSignals.length,
              social: socialSignals.length,
              infrastructure: infrastructureSignals.length
            },
            entity_counts: {
              high_threat: highThreatEntities.length,
              mentions: entityMentions.length
            },
            predictions
          },
          key_indicators: keyIndicators,
          recommended_actions: recommendedActions
        })
        .select('id')
        .single();

      if (!snapshotError && snapshot) {
        snapshotId = snapshot.id;
      }
    }

    return successResponse({
      threat_assessment: {
        overall_score: overallThreatScore,
        threat_level: overallThreatLevel,
        momentum: threatMomentum,
        scores: {
          radical_activity: radicalActivityScore,
          sentiment_volatility: sentimentVolatilityScore,
          precursor_activity: precursorActivityScore,
          infrastructure_risk: infrastructureRiskScore
        }
      },
      intelligence_summary: {
        signals_analyzed: signals.length,
        high_threat_entities: highThreatEntities.length,
        active_precursors: existingPrecursors.length,
        critical_assets: criticalAssets.length,
        timeframe_hours
      },
      category_breakdown: {
        by_source: Object.fromEntries(Object.entries(signalsBySource).map(([k, v]) => [k, v.length])),
        by_severity: Object.fromEntries(Object.entries(signalsBySeverity).map(([k, v]) => [k, v.length])),
        by_category: Object.fromEntries(Object.entries(signalsByCategory).map(([k, v]) => [k, v.length]))
      },
      predictions,
      snapshot_id: snapshotId,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in threat-radar-analysis:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
