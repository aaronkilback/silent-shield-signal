import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { geopolitical_event, client_business_units, analysis_horizon_months = 12 } = await req.json();
    console.log('Modeling geopolitical risk impact');

    const supabase = createServiceClient();

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

    const result = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert geopolitical risk analyst specializing in long-term strategic foresight and security planning for global operations.' },
        { role: 'user', content: analysisPrompt }
      ],
      functionName: 'model-geopolitical-risk',
      dlqOnFailure: true,
      dlqPayload: { geopolitical_event, client_business_units, analysis_horizon_months },
    });

    if (result.error) {
      throw new Error(result.error);
    }

    console.log('Geopolitical risk model completed');

    return successResponse({ 
      geopolitical_event,
      analysis_horizon_months,
      risk_analysis: result.content,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in model-geopolitical-risk:', error);
    await logError(error, { functionName: 'model-geopolitical-risk', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
