import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { countermeasure_plan, threat_scenario_id } = await req.json();
    console.log('Evaluating countermeasure impact for scenario:', threat_scenario_id);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createServiceClient();

    // Fetch threat scenario details (could be a signal or incident)
    let scenarioData = null;
    if (threat_scenario_id) {
      const { data: signal } = await supabase
        .from('signals')
        .select('*')
        .eq('id', threat_scenario_id)
        .single();
      
      if (signal) {
        scenarioData = signal;
      } else {
        const { data: incident } = await supabase
          .from('incidents')
          .select('*')
          .eq('id', threat_scenario_id)
          .single();
        scenarioData = incident;
      }
    }

    const evaluationPrompt = `
You are a tactical defense analyst evaluating the effectiveness of proposed countermeasures against a specific threat scenario.

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
- Potential for circumvention or adaptation by threat actors

Provide a structured evaluation that helps security teams prioritize and sequence countermeasure deployment.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert defense analyst specializing in tactical security evaluation and optimization.' },
          { role: 'user', content: evaluationPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const evaluation = data.choices?.[0]?.message?.content;

    if (!evaluation) {
      throw new Error('No evaluation generated');
    }

    console.log('Countermeasure impact evaluation completed');

    return successResponse({ 
      threat_scenario_id,
      evaluation,
      evaluated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in evaluate-countermeasure-impact:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
