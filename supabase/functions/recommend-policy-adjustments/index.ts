import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { client_id, threat_scenario_context } = await req.json();
    console.log('Recommending policy adjustments for client:', client_id);

    const supabase = createServiceClient();

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    const { data: incidentOutcomes } = await supabase
      .from('incident_outcomes')
      .select(`*, incidents:incident_id (*)`)
      .limit(20);

    const { data: criticalSignals } = await supabase
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .in('severity', ['high', 'critical'])
      .order('detected_at', { ascending: false })
      .limit(30);

    const recommendationPrompt = `
You are a security policy strategist recommending security policy and procedure adjustments based on threat intelligence and incident learnings.

CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry || 'Unknown'}
- Current Risk Assessment: ${JSON.stringify(client.risk_assessment || {})}
- Monitoring Configuration: ${JSON.stringify(client.monitoring_config || {})}

THREAT SCENARIO CONTEXT:
${threat_scenario_context || 'General policy review'}

INCIDENT LESSONS LEARNED:
${incidentOutcomes?.length ? incidentOutcomes.map(outcome => 
  `- Outcome: ${outcome.outcome_type}, Lessons: ${outcome.lessons_learned || 'None documented'}`
).join('\n') : 'No recent incident outcomes'}

RECENT CRITICAL THREATS:
${criticalSignals?.length ? `${criticalSignals.length} high/critical severity signals in recent period` : 'No recent critical threats'}

TASK:
Recommend specific adjustments to security policies and operational procedures to address identified gaps and lessons learned. Provide:

1. POLICY GAP ANALYSIS
2. RECOMMENDED POLICY CHANGES (Access Control, Incident Response, Operational Security, Cyber Security, Physical Security)
3. IMPLEMENTATION GUIDANCE
4. CHANGE MANAGEMENT
5. CONTINUOUS IMPROVEMENT

Focus on practical, enforceable policies that directly address observed threat patterns and incident lessons learned.`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert security policy strategist specializing in security program governance and operational procedures.' },
        { role: 'user', content: recommendationPrompt }
      ],
      functionName: 'recommend-policy-adjustments',
      dlqOnFailure: true,
      dlqPayload: { client_id, threat_scenario_context },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    console.log('Policy adjustment recommendations generated');

    return successResponse({ 
      client_id,
      policy_recommendations: aiResult.content,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in recommend-policy-adjustments:', error);
    await logError(error, { functionName: 'recommend-policy-adjustments', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
