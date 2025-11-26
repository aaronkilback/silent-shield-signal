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

    const { threat_actor_profile, target_asset_id, vulnerability_id } = await req.json();

    console.log(`[simulate-attack-path] Simulating attack from ${threat_actor_profile} on asset ${target_asset_id}`);

    // Fetch target asset details (from client data)
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", target_asset_id)
      .single();

    if (clientError) {
      console.error("[simulate-attack-path] Client fetch error:", clientError);
    }

    // Fetch threat actor entity information
    const { data: threatActor, error: actorError } = await supabase
      .from("entities")
      .select("*")
      .ilike("name", `%${threat_actor_profile}%`)
      .limit(1)
      .single();

    if (actorError) {
      console.error("[simulate-attack-path] Threat actor fetch error:", actorError);
    }

    // Fetch related signals for threat intelligence
    const { data: relatedSignals, error: signalsError } = await supabase
      .from("signals")
      .select("normalized_text, severity, category, created_at")
      .or(`normalized_text.ilike.%${threat_actor_profile}%,normalized_text.ilike.%${vulnerability_id || ''}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (signalsError) {
      console.error("[simulate-attack-path] Signals fetch error:", signalsError);
    }

    // Construct AI prompt for attack path simulation
    const simulationPrompt = `You are a cybersecurity threat modeling expert. Simulate a detailed attack path based on the following intelligence:

THREAT ACTOR PROFILE:
${threatActor ? `
- Name: ${threatActor.name}
- Type: ${threatActor.type}
- Threat Score: ${threatActor.threat_score || 'Unknown'}
- Known Indicators: ${threatActor.threat_indicators?.join(', ') || 'None'}
- Description: ${threatActor.description || 'No description available'}
` : `
- Name: ${threat_actor_profile}
- Profile: Unknown threat actor, analyze based on industry patterns
`}

TARGET ASSET:
${client ? `
- Organization: ${client.name}
- Industry: ${client.industry}
- Locations: ${client.locations?.join(', ') || 'Unknown'}
- High-Value Assets: ${client.high_value_assets?.join(', ') || 'Unknown'}
- Employee Count: ${client.employee_count || 'Unknown'}
` : `
- Asset ID: ${target_asset_id}
- Details: Limited asset information available
`}

VULNERABILITY CONTEXT:
- Vulnerability ID: ${vulnerability_id || 'Generic attack vector'}
${vulnerability_id ? '- Analyze exploitation of this specific vulnerability' : '- Analyze most likely attack vectors for this threat actor'}

RECENT THREAT INTELLIGENCE:
${relatedSignals && relatedSignals.length > 0 ? relatedSignals.map(s => `- [${s.severity}] ${s.normalized_text.substring(0, 150)}...`).join('\n') : 'No recent related signals'}

SIMULATION REQUIREMENTS:
1. **Initial Access**: How would the threat actor gain initial access? Consider phishing, exploitation, supply chain, insider threat, physical security breach.
2. **Privilege Escalation**: What techniques would be used to gain elevated privileges?
3. **Lateral Movement**: How would they move through the network to reach high-value assets?
4. **Persistence Mechanisms**: What backdoors or persistence methods would be established?
5. **Data Exfiltration/Impact**: How would they achieve their objectives (steal data, disrupt operations, cause damage)?
6. **Detection Avoidance**: What evasion techniques would be employed?
7. **Timeline Estimation**: Approximate time from initial access to impact (hours/days/weeks)
8. **Likelihood Assessment**: Rate likelihood (High/Medium/Low) based on threat actor capabilities and target defenses

Provide a structured, realistic attack path simulation with specific technical details, TTPs (Tactics, Techniques, Procedures), and mitigation recommendations.`;

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
            content: "You are a threat modeling and attack simulation expert. Provide detailed, realistic attack path simulations based on threat intelligence."
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
    const simulationAnalysis = aiResult.choices[0].message.content;

    // Extract key findings for structured response
    const likelihoodMatch = simulationAnalysis.match(/Likelihood[:\s]+(\w+)/i);
    const timelineMatch = simulationAnalysis.match(/Timeline[:\s]+([^\n]+)/i);

    return new Response(
      JSON.stringify({
        success: true,
        threat_actor: threat_actor_profile,
        target_asset_id,
        vulnerability_id,
        simulation: {
          full_analysis: simulationAnalysis,
          likelihood: likelihoodMatch ? likelihoodMatch[1] : "Medium",
          estimated_timeline: timelineMatch ? timelineMatch[1] : "Unknown",
          threat_actor_capabilities: threatActor?.threat_score || "Unknown",
          related_signals_count: relatedSignals?.length || 0,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[simulate-attack-path] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
