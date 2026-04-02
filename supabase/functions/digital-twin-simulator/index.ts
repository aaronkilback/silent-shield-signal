/**
 * Tier 7: Digital Twin Simulation Engine
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const {
      simulation_type,
      target_entity_id,
      target_client_id,
      scenario_parameters,
    } = body;

    const supabase = createServiceClient();
    const dateContext = getCriticalDateContext();
    const simType = simulation_type || 'compound_crisis';

    console.log(`[DigitalTwin] Starting ${simType} simulation`);

    // Create simulation record
    const { data: simRecord } = await supabase.from('simulation_scenarios').insert({
      name: `${simType} Simulation - ${dateContext.currentDateISO}`,
      scenario_type: simType,
      target_entity_id,
      target_client_id,
      parameters: scenario_parameters || body,
      status: 'running',
      model_used: 'gpt-5.2',
    }).select('id').single();

    // ========== GATHER INTELLIGENCE CONTEXT ==========
    const [
      entityData, clientData, recentThreats, activeIncidents,
      vulnerabilities, travelData, adversaryEntities, playbooks,
    ] = await Promise.all([
      target_entity_id
        ? supabase.from('entities').select('*').eq('id', target_entity_id).single().then(r => r.data)
        : Promise.resolve(null),
      target_client_id
        ? supabase.from('clients').select('*').eq('id', target_client_id).single().then(r => r.data)
        : Promise.resolve(null),
      supabase.from('signals').select('id, title, category, severity, normalized_text, location, entity_tags, created_at')
        .order('created_at', { ascending: false }).limit(50).then(r => r.data || []),
      supabase.from('incidents').select('id, priority, status, severity_level')
        .eq('status', 'open').limit(20).then(r => r.data || []),
      supabase.from('asset_vulnerabilities').select('id, vulnerability_id, severity, cvss_score, remediation_status, affected_component')
        .eq('remediation_status', 'open').order('cvss_score', { ascending: false }).limit(20).then(r => r.data || []),
      target_entity_id
        ? supabase.from('travelers').select('id, name, itineraries(*)').limit(5).then(r => r.data || [])
        : Promise.resolve([]),
      supabase.from('entities').select('id, name, type, threat_score, risk_level, description')
        .in('type', ['threat_actor', 'adversary', 'competitor'])
        .order('threat_score', { ascending: false }).limit(10).then(r => r.data || []),
      supabase.from('investigation_playbooks').select('name, threat_category, steps, countermeasures, effectiveness_score')
        .eq('is_active', true).order('effectiveness_score', { ascending: false }).limit(5).then(r => r.data || []),
    ]);

    // ========== BUILD SIMULATION PROMPT ==========
    const simulationPrompts: Record<string, string> = {
      travel_risk: `SIMULATION TYPE: TRAVEL RISK ASSESSMENT
Analyze what happens if ${entityData?.name || 'the principal'} travels to ${scenario_parameters?.destination || 'an unspecified destination'} during ${scenario_parameters?.timeframe || 'the next 7 days'}.

Consider: local threat landscape, adversary presence, geopolitical stability, natural disaster risk, health risks, communication security, extraction routes.`,

      attack_chain: `SIMULATION TYPE: ATTACK CHAIN MODELING
Model a multi-stage attack against ${clientData?.name || 'the organization'} (Industry: ${clientData?.industry || 'unknown'}).

Known vulnerabilities: ${JSON.stringify(vulnerabilities.slice(0, 5))}
High-value assets: ${clientData?.high_value_assets?.join(', ') || 'Not specified'}

Model the FULL kill chain: Reconnaissance → Weaponization → Delivery → Exploitation → Installation → C2 → Actions on Objective. For EACH stage, provide specific techniques (MITRE ATT&CK), likelihood, detection opportunities, and countermeasures.`,

      adversary_action: `SIMULATION TYPE: ADVERSARY ACTION PREDICTION
Predict the most likely actions of ${scenario_parameters?.adversary_name || 'known threat actors'} against ${entityData?.name || clientData?.name || 'the target'}.

Known adversaries: ${JSON.stringify(adversaryEntities.slice(0, 5))}
Recent threat signals: ${JSON.stringify(recentThreats.slice(0, 10).map(s => ({ severity: s.severity, category: s.category, text: (s.normalized_text || '').substring(0, 100) })))}

Analyze: adversary capability, intent indicators, likely attack vectors, timeline estimate, and recommended preemptive countermeasures.`,

      compound_crisis: `SIMULATION TYPE: COMPOUND CRISIS SCENARIO
Model a cascading crisis scenario where multiple threats converge simultaneously against ${clientData?.name || entityData?.name || 'the organization'}.

Parameters: ${JSON.stringify(scenario_parameters || {})}

Active incidents: ${activeIncidents.length} open
Recent high-severity signals: ${recentThreats.filter(s => ['critical', 'high'].includes(s.severity || '')).length}
Unpatched critical vulnerabilities: ${vulnerabilities.filter(v => v.severity === 'critical').length}

Model a realistic compound scenario: initial trigger → cascade effects → resource exhaustion → secondary failures → recovery path. Include timeline, probability at each stage, and critical decision points.`,
    };

    const prompt = simulationPrompts[simType] || simulationPrompts.compound_crisis;

    const contextBlock = `
FULL INTELLIGENCE CONTEXT:

TARGET ENTITY: ${entityData ? JSON.stringify({ name: entityData.name, type: entityData.type, risk_level: entityData.risk_level, threat_score: entityData.threat_score }) : 'N/A'}

TARGET ORGANIZATION: ${clientData ? JSON.stringify({ name: clientData.name, industry: clientData.industry, locations: clientData.locations, employee_count: clientData.employee_count }) : 'N/A'}

CURRENT THREAT POSTURE:
- Active incidents: ${activeIncidents.length} (P1: ${activeIncidents.filter(i => i.priority === 'p1').length}, P2: ${activeIncidents.filter(i => i.priority === 'p2').length})
- Critical vulnerabilities: ${vulnerabilities.filter(v => v.severity === 'critical').length}
- High-severity signals (24h): ${recentThreats.filter(s => s.severity === 'critical' || s.severity === 'high').length}

EXISTING PLAYBOOKS: ${playbooks.map(p => p.name).join(', ') || 'None'}

AVAILABLE COUNTERMEASURES FROM PLAYBOOKS:
${playbooks.flatMap(p => (p.countermeasures as any[] || []).map((c: any) => `- ${c.name}: ${c.description?.substring(0, 80) || ''}`)).slice(0, 10).join('\n')}
`;

    // ========== RUN SIMULATION ==========
    const systemPrompt = `You are a senior Red Team simulation architect and crisis management expert. Run realistic threat simulations using real intelligence data. Your simulations must be:
1. Grounded in the actual threat landscape data provided
2. Specific with timelines, probabilities, and decision points
3. Actionable with clear countermeasures
4. Calibrated—avoid catastrophizing, use probability-weighted outcomes

Current date: ${dateContext.currentDateISO}

OUTPUT FORMAT (respond ONLY with valid JSON):
{
  "simulation_name": "Descriptive name",
  "executive_summary": "2-3 sentence overview",
  "overall_risk_score": 0-100,
  "confidence_level": 0-100,
  "timeline": [
    {
      "phase": "Phase name",
      "timeframe": "T+0h to T+4h",
      "events": ["Event descriptions"],
      "probability": 0.85,
      "impact_level": "critical|high|medium|low",
      "decision_point": "Key decision required",
      "recommended_action": "What to do"
    }
  ],
  "attack_chains": [
    {
      "name": "Chain name",
      "stages": ["stage1", "stage2"],
      "mitre_techniques": ["T1566", "T1078"],
      "likelihood": 0.6,
      "impact": "Description of impact"
    }
  ],
  "cascade_effects": ["Effect 1", "Effect 2"],
  "critical_decision_points": [
    {
      "trigger": "When this happens",
      "options": ["Option A", "Option B"],
      "recommended": "Option A",
      "rationale": "Why"
    }
  ],
  "countermeasures": [
    {
      "name": "Countermeasure",
      "type": "preemptive|reactive|recovery",
      "priority": "immediate|24h|72h",
      "description": "Details",
      "effectiveness_estimate": 0.75,
      "resource_requirement": "low|medium|high"
    }
  ],
  "recovery_path": {
    "estimated_recovery_hours": 48,
    "key_milestones": ["Milestone 1", "Milestone 2"],
    "residual_risks": ["Risk 1"]
  },
  "lessons_applicable": ["Relevant past lessons"]
}`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${prompt}\n\n${contextBlock}` },
      ],
      functionName: 'digital-twin-simulator',
      extraBody: { max_tokens: 4000, temperature: 0.4 },
      dlqOnFailure: true,
      dlqPayload: { simulation_type: simType, target_entity_id, target_client_id },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    const content = aiResult.content || '';

    let simulationResults: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      simulationResults = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: content };
    } catch {
      simulationResults = { raw: content, parse_error: true };
    }

    // Update simulation record
    if (simRecord?.id) {
      await supabase.from('simulation_scenarios').update({
        results: simulationResults,
        risk_score: simulationResults.overall_risk_score || null,
        confidence_score: simulationResults.confidence_level || null,
        attack_chains: simulationResults.attack_chains || [],
        recommendations: simulationResults.countermeasures || [],
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', simRecord.id);
    }

    // Log autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'digital_twin_simulation',
      trigger_source: 'manual',
      action_details: {
        simulation_id: simRecord?.id,
        simulation_type: simType,
        risk_score: simulationResults.overall_risk_score,
        attack_chains_count: (simulationResults.attack_chains || []).length,
        countermeasures_count: (simulationResults.countermeasures || []).length,
      },
      status: 'completed',
    });

    console.log(`[DigitalTwin] Simulation complete. Risk: ${simulationResults.overall_risk_score}/100`);

    return successResponse({
      simulation_id: simRecord?.id,
      simulation_type: simType,
      ...simulationResults,
    });
  } catch (error) {
    console.error('[DigitalTwin] Error:', error);
    await logError(error, { functionName: 'digital-twin-simulator', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});