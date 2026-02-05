import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    const { client_operation_flow, threat_scenario } = await req.json();

    console.log(`[identify-critical-failure-points] Analyzing: ${client_operation_flow}`);

    // Parse client_operation_flow (could be client_id or description)
    let clientData;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (uuidRegex.test(client_operation_flow)) {
      // It's a client ID
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", client_operation_flow)
        .single();

      if (!clientError && client) {
        clientData = client;
      }
    }

    // Fetch recent incidents for failure pattern analysis
    const { data: incidents, error: incidentsError } = await supabase
      .from("incidents")
      .select("incident_type, priority, severity_level, status, summary, incident_outcomes(outcome_type, lessons_learned)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (incidentsError) {
      console.error("[identify-critical-failure-points] Incidents fetch error:", incidentsError);
    }

    // Fetch signals related to operational disruptions
    const { data: disruptionSignals, error: signalsError } = await supabase
      .from("signals")
      .select("normalized_text, category, severity, created_at")
      .or("category.eq.supply_chain,category.eq.infrastructure,category.eq.cyber,category.eq.operational_disruption,normalized_text.ilike.%disruption%,normalized_text.ilike.%outage%,normalized_text.ilike.%failure%")
      .order("created_at", { ascending: false })
      .limit(30);

    if (signalsError) {
      console.error("[identify-critical-failure-points] Signals fetch error:", signalsError);
    }

    // Analyze historical failure patterns
    const failurePatterns = new Map<string, number>();
    if (incidents) {
      for (const incident of incidents) {
        const type = incident.incident_type || "unknown";
        failurePatterns.set(type, (failurePatterns.get(type) || 0) + 1);
      }
    }

    const topFailureTypes = Array.from(failurePatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => `${type}: ${count} incidents`);

    // Construct AI prompt for failure point analysis
    const analysisPrompt = `You are a business continuity and operational resilience expert. Identify critical failure points in the operational flow under the specified threat scenario.

OPERATIONAL CONTEXT:
${clientData ? `
CLIENT INFORMATION:
- Organization: ${clientData.name}
- Industry: ${clientData.industry}
- Locations: ${clientData.locations?.join(', ') || 'Unknown'}
- High-Value Assets: ${clientData.high_value_assets?.join(', ') || 'Unknown'}
- Supply Chain Entities: ${clientData.supply_chain_entities?.join(', ') || 'None documented'}
- Employee Count: ${clientData.employee_count || 'Unknown'}
` : `
OPERATIONAL FLOW DESCRIPTION:
${client_operation_flow}
`}

THREAT SCENARIO:
${threat_scenario}

HISTORICAL FAILURE PATTERNS:
${topFailureTypes.length > 0 ? topFailureTypes.join('\n') : 'No historical incident data'}

RECENT OPERATIONAL DISRUPTIONS:
${disruptionSignals && disruptionSignals.length > 0 ? disruptionSignals.slice(0, 5).map(s => `- [${s.severity}] ${(s.normalized_text || 'No details').substring(0, 100)}...`).join('\n') : 'No recent disruption signals'}

LESSONS FROM PAST INCIDENTS:
${incidents && incidents.length > 0 ? incidents.filter(i => i.incident_outcomes && i.incident_outcomes.length > 0 && i.incident_outcomes[0].lessons_learned).slice(0, 3).map(i => `- ${i.incident_outcomes[0].lessons_learned}`).join('\n') : 'No lessons learned data'}

ANALYSIS REQUIREMENTS:
1. **Critical Failure Points**: Identify 5-7 specific points in the operational flow where failure would cause maximum disruption
   - For each: Name, Description, Criticality (High/Critical), Impact if failed
   
2. **Single Points of Failure (SPOFs)**: Highlight dependencies with no redundancy
   - Systems, vendors, personnel, infrastructure, processes
   
3. **Cascading Effects Analysis**: Map how failure at one point triggers failures elsewhere
   - Primary failure → Secondary failures → Tertiary impacts
   
4. **Vulnerability to Threat Scenario**: Rate how each failure point is vulnerable to the specific threat
   - Direct exposure level (High/Medium/Low)
   - Likelihood of exploitation (High/Medium/Low)
   
5. **Time to Impact**: Estimate how quickly each failure would affect operations
   - Immediate (< 1 hour)
   - Short-term (1-24 hours)
   - Medium-term (1-7 days)
   
6. **Business Impact Assessment**:
   - Financial impact per failure point ($/hour, total estimated cost)
   - Operational impact (percentage of operations affected)
   - Reputational damage potential
   
7. **Mitigation Priority**: Rank failure points by priority for mitigation
   - Must Fix (P1): Critical, high probability
   - Should Fix (P2): High impact, medium probability
   - Consider (P3): Lower probability or impact
   
8. **Specific Recommendations**: For top 3 critical failure points, provide:
   - Redundancy strategies
   - Backup procedures
   - Early warning indicators
   - Response protocols

Provide a structured, actionable failure point analysis with specific technical and operational details.`;

    // Call AI for analysis
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a business continuity and operational resilience expert. Provide detailed, actionable analysis of critical failure points and vulnerabilities."
          },
          {
            role: "user",
            content: analysisPrompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const failureAnalysis = aiResult.choices[0].message.content;

    // Extract structured findings
    const criticalPointsCount = (failureAnalysis.match(/Critical Failure Point/gi) || []).length;
    const spofsCount = (failureAnalysis.match(/Single Point of Failure/gi) || []).length;

    return successResponse({
      success: true,
      operation_context: clientData ? clientData.name : client_operation_flow,
      threat_scenario,
      failure_analysis: {
        full_analysis: failureAnalysis,
        critical_points_identified: criticalPointsCount,
        single_points_of_failure: spofsCount,
        historical_context: {
          total_incidents_analyzed: incidents?.length || 0,
          top_failure_types: topFailureTypes,
          disruption_signals: disruptionSignals?.length || 0,
        },
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[identify-critical-failure-points] Error:", error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
