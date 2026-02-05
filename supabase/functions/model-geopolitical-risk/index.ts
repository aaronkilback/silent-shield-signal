import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { geopolitical_event, client_business_units, analysis_horizon_months = 12 } = await req.json();
    console.log('Modeling geopolitical risk impact');

    const supabase = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch recent geopolitical/international threat signals
    const { data: geopoliticalSignals } = await supabase
      .from('signals')
      .select('*')
      .or('rule_category.eq.geopolitical,rule_category.eq.international')
      .order('detected_at', { ascending: false })
      .limit(50);

    const analysisPrompt = `
You are a geopolitical risk analyst modeling long-term security implications for multinational operations.

GEOPOLITICAL EVENT/SCENARIO:
${geopolitical_event}

CLIENT BUSINESS UNITS/OPERATIONS:
${JSON.stringify(client_business_units, null, 2)}

ANALYSIS HORIZON: ${analysis_horizon_months} months

RECENT GEOPOLITICAL INTELLIGENCE:
${geopoliticalSignals?.length ? `${geopoliticalSignals.length} relevant signals monitored` : 'Limited recent intelligence'}

TASK:
Conduct a comprehensive geopolitical risk assessment projecting security implications over the specified time horizon. Provide:

1. THREAT LANDSCAPE EVOLUTION:
   - Primary threat vectors (cyber espionage, supply chain disruption, physical security)
   - Likelihood of escalation (Low/Medium/High)
   - Potential trigger events

2. BUSINESS UNIT IMPACT ANALYSIS:
   For each affected business unit:
   - Direct operational impacts
   - Supply chain vulnerabilities
   - Personnel safety risks
   - Regulatory/compliance changes
   - Estimated financial exposure

3. CASCADING EFFECTS:
   - Second-order impacts (e.g., trade sanctions → technology access)
   - Regional spillover risks
   - Market/commodity price impacts
   - Cyber threat landscape shifts

4. TIMELINE PROJECTIONS:
   - 0-3 months: Immediate impacts & emerging threats
   - 3-6 months: Medium-term developments
   - 6-12 months: Strategic long-term implications
   - Beyond 12 months: Structural changes

5. MITIGATION STRATEGIES:
   - Risk transfer options (insurance, partnerships)
   - Diversification strategies
   - Contingency planning requirements
   - Strategic adjustments to operations

6. MONITORING INDICATORS:
   - Key early warning signals to track
   - Trigger points for action
   - Intelligence collection priorities

Consider:
- Historical precedents and patterns
- Regional geopolitical dynamics
- Economic interdependencies
- Technology and cyber threat evolution
- State and non-state actor capabilities

Provide actionable foresight for strategic decision-making.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert geopolitical risk analyst specializing in long-term strategic foresight and security planning for global operations.' },
          { role: 'user', content: analysisPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    if (!analysis) {
      throw new Error('No analysis generated');
    }

    console.log('Geopolitical risk model completed');

    return successResponse({ 
      geopolitical_event,
      analysis_horizon_months,
      risk_analysis: analysis,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in model-geopolitical-risk:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
