/**
 * Predictive Incident Scorer (Tier 3)
 * 
 * Uses historical incident outcomes to predict which signals will escalate
 * to critical incidents. Generates escalation probability scores.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { signal_id, batch_mode } = await req.json();
    const supabase = createServiceClient();
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    // Get signal(s) to score
    let signalsToScore: any[] = [];

    if (batch_mode) {
      // Score all unscored recent signals
      const cutoff = new Date(Date.now() - 24 * 3600000).toISOString();
      const { data } = await supabase
        .from('signals')
        .select('id, normalized_text, category, severity, location, entity_tags, confidence, created_at, client_id')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(50);
      signalsToScore = data || [];
    } else if (signal_id) {
      const { data } = await supabase
        .from('signals')
        .select('id, normalized_text, category, severity, location, entity_tags, confidence, created_at, client_id')
        .eq('id', signal_id)
        .single();
      if (data) signalsToScore = [data];
    }

    if (signalsToScore.length === 0) {
      return successResponse({ scored: 0, message: 'No signals to score' });
    }

    // Fetch historical escalation patterns (signals that became incidents)
    const { data: escalatedSignals } = await supabase
      .from('incidents')
      .select('signal_id, priority, severity_level, status')
      .not('signal_id', 'is', null)
      .limit(500);

    const escalationSet = new Set((escalatedSignals || []).map(i => i.signal_id));
    const priorityMap = new Map<string, string>();
    for (const inc of escalatedSignals || []) {
      priorityMap.set(inc.signal_id, inc.priority || 'p4');
    }

    // Compute historical category escalation rates
    const { data: historicalSignals } = await supabase
      .from('signals')
      .select('id, category, severity')
      .order('created_at', { ascending: false })
      .limit(2000);

    const categoryEscalationRates: Record<string, { total: number; escalated: number }> = {};
    for (const s of historicalSignals || []) {
      const cat = s.category || 'unknown';
      if (!categoryEscalationRates[cat]) categoryEscalationRates[cat] = { total: 0, escalated: 0 };
      categoryEscalationRates[cat].total++;
      if (escalationSet.has(s.id)) categoryEscalationRates[cat].escalated++;
    }

    // Load accuracy calibration multipliers per agent call sign.
    // PREDICTIVE-SCORER's calibration factor adjusts final probabilities based on
    // how well its past predictions matched actual outcomes.
    const { data: calibrationRows } = await supabase
      .from('agent_accuracy_metrics')
      .select('agent_call_sign, confidence_calibration, accuracy_score, total_predictions')
      .eq('agent_call_sign', 'PREDICTIVE-SCORER')
      .maybeSingle();

    // calibration = 1.0 means perfectly calibrated; < 1.0 = overconfident; > 1.0 = underconfident
    const calibrationFactor = (calibrationRows?.total_predictions || 0) >= 10
      ? Math.max(0.5, Math.min(1.5, calibrationRows!.confidence_calibration))
      : 1.0; // Don't adjust until we have 10+ resolved predictions

    console.log(`[PredictiveScorer] Calibration factor: ${calibrationFactor.toFixed(3)} (${calibrationRows?.total_predictions || 0} resolved predictions)`);

    // Score each signal
    const scores: any[] = [];
    for (const signal of signalsToScore) {
      const factors: any[] = [];
      let probability = 0.1; // Base rate

      // Factor 1: Category historical escalation rate
      const cat = signal.category || 'unknown';
      const catRate = categoryEscalationRates[cat];
      if (catRate && catRate.total > 5) {
        const escalationRate = catRate.escalated / catRate.total;
        probability += escalationRate * 0.3;
        factors.push({ name: 'Category Rate', value: escalationRate, weight: 0.3 });
      }

      // Factor 2: Severity
      const sevMap: Record<string, number> = { critical: 0.35, high: 0.25, medium: 0.1, low: 0.02 };
      const sevBoost = sevMap[signal.severity?.toLowerCase() || ''] || 0.05;
      probability += sevBoost;
      factors.push({ name: 'Severity', value: signal.severity, weight: sevBoost });

      // Factor 3: Entity count (more entities = higher complexity = higher risk)
      const entityCount = signal.entity_tags?.length || 0;
      if (entityCount >= 3) {
        const entityBoost = Math.min(0.15, entityCount * 0.03);
        probability += entityBoost;
        factors.push({ name: 'Entity Complexity', value: entityCount, weight: entityBoost });
      }

      // Factor 4: Confidence inversion (low-confidence high-severity = danger)
      if (signal.confidence < 0.4 && ['critical', 'high'].includes(signal.severity?.toLowerCase() || '')) {
        probability += 0.1;
        factors.push({ name: 'Low-Confidence High-Sev', value: signal.confidence, weight: 0.1 });
      }

      // Factor 5: Location-based risk (signals with specific locations escalate more)
      if (signal.location && signal.location !== 'unknown' && signal.location.length > 3) {
        probability += 0.05;
        factors.push({ name: 'Location Specificity', value: signal.location, weight: 0.05 });
      }

      // Apply accuracy calibration — if the scorer has been historically overconfident,
      // pull probabilities toward the base rate; if underconfident, push them higher.
      probability = probability * calibrationFactor;
      probability = Math.min(0.95, Math.max(0.01, probability));

      // Determine predicted severity/priority
      let predictedSeverity = 'low';
      let predictedPriority = 'p4';
      if (probability > 0.7) { predictedSeverity = 'critical'; predictedPriority = 'p1'; }
      else if (probability > 0.5) { predictedSeverity = 'high'; predictedPriority = 'p2'; }
      else if (probability > 0.3) { predictedSeverity = 'medium'; predictedPriority = 'p3'; }

      // Store prediction
      await supabase.from('predictive_incident_scores').upsert({
        signal_id: signal.id,
        escalation_probability: Math.round(probability * 100) / 100,
        predicted_severity: predictedSeverity,
        predicted_priority: predictedPriority,
        contributing_factors: [...factors, { name: 'CalibrationFactor', value: calibrationFactor, weight: 0 }],
        model_version: 'v2-calibrated',
        scored_at: new Date().toISOString(),
      }, { onConflict: 'signal_id' });

      scores.push({
        signal_id: signal.id,
        escalation_probability: Math.round(probability * 100),
        predicted_severity: predictedSeverity,
        predicted_priority: predictedPriority,
        top_factors: factors.sort((a, b) => b.weight - a.weight).slice(0, 3),
      });
    }

    console.log(`[PredictiveScorer] Scored ${scores.length} signals. High-risk: ${scores.filter(s => s.escalation_probability > 50).length}`);

    return successResponse({
      scored: scores.length,
      high_risk_count: scores.filter(s => s.escalation_probability > 50).length,
      scores: scores.sort((a, b) => b.escalation_probability - a.escalation_probability),
    });
  } catch (error) {
    console.error('[PredictiveScorer] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
