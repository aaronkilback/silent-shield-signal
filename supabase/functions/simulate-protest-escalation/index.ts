import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { signal_id, escalation_factors } = await req.json();

    console.log(`[simulate-protest-escalation] Analyzing signal ${signal_id}`);

    // Fetch the signal
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*, clients(name, industry, locations)")
      .eq("id", signal_id)
      .single();

    if (signalError || !signal) {
      throw new Error(`Signal not found: ${signal_id}`);
    }

    // Fetch historical protest/demonstration signals
    const { data: historicalProtests, error: historyError } = await supabase
      .from("signals")
      .select("normalized_text, severity, category, created_at")
      .or("category.eq.protest,category.eq.demonstration,category.eq.civil_unrest,normalized_text.ilike.%protest%,normalized_text.ilike.%demonstration%")
      .order("created_at", { ascending: false })
      .limit(50);

    if (historyError) {
      console.error("[simulate-protest-escalation] History fetch error:", historyError);
    }

    // Fetch incidents related to protests
    const { data: historicalIncidents, error: incidentsError } = await supabase
      .from("incidents")
      .select("priority, severity_level, status, opened_at, resolved_at, incident_outcomes(false_positive, outcome_type)")
      .or("incident_type.eq.protest,incident_type.eq.civil_unrest")
      .order("opened_at", { ascending: false })
      .limit(30);

    if (incidentsError) {
      console.error("[simulate-protest-escalation] Incidents fetch error:", incidentsError);
    }

    // Calculate escalation patterns from historical data
    let escalatedCount = 0;
    let totalIncidents = historicalIncidents?.length || 0;
    let violentCount = 0;

    if (historicalIncidents) {
      for (const incident of historicalIncidents) {
        if (incident.priority === "p1" || incident.priority === "p2") {
          escalatedCount++;
        }
        if (incident.incident_outcomes && incident.incident_outcomes.length > 0) {
          if (incident.incident_outcomes[0].outcome_type === "violence") {
            violentCount++;
          }
        }
      }
    }

    const historicalEscalationRate = totalIncidents > 0 ? (escalatedCount / totalIncidents) : 0.3;
    const historicalViolenceRate = totalIncidents > 0 ? (violentCount / totalIncidents) : 0.1;

    // Construct AI prompt for escalation simulation
    const simulationPrompt = `You are a civil unrest and protest analysis expert. Predict the likelihood and nature of escalation for the following protest/demonstration:

CURRENT PROTEST SIGNAL:
- Signal Text: ${signal.normalized_text}
- Severity: ${signal.severity}
- Category: ${signal.category}
- Location Context: ${signal.clients?.locations?.join(', ') || 'Unknown'}
- Industry Impact: ${signal.clients?.industry || 'Unknown'}
- Detected: ${signal.created_at}

ESCALATION FACTORS PROVIDED:
${escalation_factors || 'No specific factors provided'}

HISTORICAL PROTEST PATTERNS:
- Total Historical Protests Analyzed: ${historicalProtests?.length || 0}
- Historical Escalation Rate: ${(historicalEscalationRate * 100).toFixed(1)}%
- Historical Violence Rate: ${(historicalViolenceRate * 100).toFixed(1)}%
- Recent Incidents: ${totalIncidents} incidents in past period

RECENT SIMILAR PROTESTS:
${historicalProtests && historicalProtests.length > 0 ? historicalProtests.slice(0, 5).map(p => `- [${p.severity}] ${p.normalized_text.substring(0, 100)}...`).join('\n') : 'No recent protest data'}

ANALYSIS REQUIREMENTS:
1. **Escalation Likelihood**: Rate the probability of escalation (Low/Medium/High/Critical) with percentage
2. **Escalation Triggers**: Identify specific factors that could trigger escalation (police response, counter-protesters, weather, time of day, grievance severity)
3. **Potential Outcomes**:
   - Peaceful dispersal (likelihood %)
   - Prolonged occupation (likelihood %)
   - Property damage (likelihood %)
   - Violence/clashes (likelihood %)
   - Operational disruption to client (likelihood %, duration estimate)
4. **Timeline Forecast**: Predict how long the protest will last (hours/days/weeks)
5. **Geographic Spread**: Will it remain localized or spread to other locations?
6. **Impact Assessment**:
   - Direct impact on client operations
   - Reputational risk
   - Employee safety concerns
   - Supply chain disruption
7. **Early Warning Indicators**: What signs would indicate escalation is imminent?
8. **Recommended Actions**: Specific operational recommendations for client

Provide a data-driven, realistic escalation forecast with specific probabilities and actionable intelligence.`;

    // Call AI for simulation
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
            content: "You are a civil unrest and protest escalation expert. Provide realistic, data-driven escalation forecasts based on intelligence."
          },
          {
            role: "user",
            content: simulationPrompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const escalationAnalysis = aiResult.choices[0].message.content;

    // Extract key findings for structured response
    const likelihoodMatch = escalationAnalysis.match(/Escalation Likelihood[:\s]+(\w+)[:\s]+(\d+)%/i);
    const violenceMatch = escalationAnalysis.match(/Violence[\/\w\s]*:[:\s]+(\d+)%/i);
    const timelineMatch = escalationAnalysis.match(/Timeline[:\s]+([^\n]+)/i);

    return new Response(
      JSON.stringify({
        success: true,
        signal_id,
        signal_text: signal.normalized_text.substring(0, 150),
        escalation_forecast: {
          full_analysis: escalationAnalysis,
          escalation_likelihood: likelihoodMatch ? likelihoodMatch[1] : "Medium",
          escalation_probability: likelihoodMatch ? parseInt(likelihoodMatch[2]) : 50,
          violence_probability: violenceMatch ? parseInt(violenceMatch[1]) : Math.round(historicalViolenceRate * 100),
          estimated_duration: timelineMatch ? timelineMatch[1] : "Unknown",
          historical_context: {
            similar_protests: historicalProtests?.length || 0,
            historical_escalation_rate: (historicalEscalationRate * 100).toFixed(1) + "%",
            historical_violence_rate: (historicalViolenceRate * 100).toFixed(1) + "%",
          },
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[simulate-protest-escalation] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
