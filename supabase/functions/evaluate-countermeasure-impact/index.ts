import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { countermeasure_plan, threat_scenario_id } = await req.json();
    console.log('[CountermeasureImpact] Evaluating countermeasure impact for scenario:', threat_scenario_id);

    const supabase = createServiceClient();

    // Fetch threat scenario details
    let scenarioData = null;
    if (threat_scenario_id) {
      const { data: signal } = await supabase
        .from('signals')
        .select('id, title, normalized_text, severity, category, rule_category')
        .eq('id', threat_scenario_id)
        .single();
      
      if (signal) {
        scenarioData = signal;
      } else {
        const { data: incident } = await supabase
          .from('incidents')
          .select('id, title, severity_level, incident_type, priority, description')
          .eq('id', threat_scenario_id)
          .single();
        scenarioData = incident;
      }
    }

    const evaluationPrompt = `You are a tactical defense analyst evaluating the effectiveness of proposed countermeasures against a specific threat scenario.

COUNTERMEASURE PLAN:
${JSON.stringify(countermeasure_plan, null, 2)}

THREAT SCENARIO:
${scenarioData ? JSON.stringify(scenarioData, null, 2) : 'Generic threat scenario'}

TASK:
Evaluate each countermeasure in the plan and provide:

1. EFFECTIVENESS SCORE (0-100): How effective will this countermeasure be against this specific threat?
2. RISK REDUCTION: Estimated percentage reduction in threat likelihood or impact
3. COST-BENEFIT RATIO: Qualitative assessment (Excellent/Good/Fair/Poor)
4. IMPLEMENTATION RISKS: Potential negative consequences or implementation challenges
5. COMPLEMENTARY MEASURES: Other countermeasures that would enhance effectiveness
6. TIME-TO-EFFECT: How long until the countermeasure provides meaningful protection

Consider:
- Threat actor capabilities and likely tactics
- Physical/cyber attack vectors
- Operational environment constraints
- Resource availability and deployment speed
- Potential for circumvention by threat actors

Provide a structured evaluation that helps security teams prioritize countermeasure deployment.`;

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert defense analyst specializing in tactical security evaluation and optimization.' },
        { role: 'user', content: evaluationPrompt }
      ],
      functionName: 'evaluate-countermeasure-impact',
      dlqOnFailure: true,
      dlqPayload: { threat_scenario_id, countermeasure_plan },
    });

    const evaluation = aiResult.content;

    if (!evaluation) {
      return errorResponse('No evaluation generated', 500);
    }

    console.log('[CountermeasureImpact] Evaluation completed');

    return successResponse({ 
      threat_scenario_id,
      evaluation,
      evaluated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[CountermeasureImpact] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
