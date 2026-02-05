import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { client_id, threat_scenario_context } = await req.json();
    console.log('Recommending policy adjustments for client:', client_id);

    const supabase = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    // Fetch incident outcomes for lessons learned
    const { data: incidentOutcomes } = await supabase
      .from('incident_outcomes')
      .select(`
        *,
        incidents:incident_id (*)
      `)
      .limit(20);

    // Fetch recent high-severity signals
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

1. POLICY GAP ANALYSIS:
   - Identified weaknesses in current policies
   - Threat scenarios not adequately addressed
   - Regulatory/compliance considerations

2. RECOMMENDED POLICY CHANGES:
   
   A. ACCESS CONTROL POLICIES:
      - Physical access procedures
      - Logical access & identity management
      - Privileged access management
   
   B. INCIDENT RESPONSE PROCEDURES:
      - Detection & escalation processes
      - Communication protocols
      - Recovery procedures
   
   C. OPERATIONAL SECURITY PROCEDURES:
      - Travel security protocols
      - Facility security standards
      - Supply chain security
      - Third-party risk management
   
   D. CYBER SECURITY POLICIES:
      - Acceptable use policies
      - Data protection & privacy
      - Security awareness & training
   
   E. PHYSICAL SECURITY POLICIES:
      - Perimeter security standards
      - Visitor management
      - Emergency response

3. IMPLEMENTATION GUIDANCE:
   For each policy recommendation:
   - Specific policy language updates
   - Implementation requirements
   - Training/communication needs
   - Compliance/audit considerations
   - Rollout timeline

4. CHANGE MANAGEMENT:
   - Stakeholder approval process
   - Communication strategy
   - Training programs
   - Effectiveness metrics

5. CONTINUOUS IMPROVEMENT:
   - Policy review cadence
   - Metrics for policy effectiveness
   - Feedback mechanisms

Focus on practical, enforceable policies that directly address observed threat patterns and incident lessons learned.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert security policy strategist specializing in security program governance and operational procedures.' },
          { role: 'user', content: recommendationPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const recommendations = data.choices?.[0]?.message?.content;

    if (!recommendations) {
      throw new Error('No recommendations generated');
    }

    console.log('Policy adjustment recommendations generated');

    return successResponse({ 
      client_id,
      policy_recommendations: recommendations,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in recommend-policy-adjustments:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
