import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// Helper to fetch principal profile data
async function getPrincipalProfile(supabase: any, entityId?: string, entityName?: string) {
  let entity = null;

  if (entityId) {
    const { data } = await supabase
      .from("entities")
      .select(`
        id, name, type, aliases, description, risk_level, threat_score, attributes,
        active_monitoring_enabled, current_location, monitoring_radius_km, client_id
      `)
      .eq("id", entityId)
      .single();
    entity = data;
  } else if (entityName) {
    const { data } = await supabase
      .from("entities")
      .select(`
        id, name, type, aliases, description, risk_level, threat_score, attributes,
        active_monitoring_enabled, current_location, monitoring_radius_km, client_id
      `)
      .or(`type.eq.person,type.eq.vip`)
      .ilike("name", `%${entityName}%`)
      .limit(1)
      .single();
    entity = data;
  }

  if (!entity) {
    return { error: "Principal entity not found" };
  }

  // Get relationships (family, adversaries)
  const { data: relationships } = await supabase
    .from("entity_relationships")
    .select(`
      id, relationship_type, strength, description,
      entity_b:entity_b_id(id, name, type, risk_level)
    `)
    .eq("entity_a_id", entity.id);

  // Get reverse relationships too
  const { data: reverseRelationships } = await supabase
    .from("entity_relationships")
    .select(`
      id, relationship_type, strength, description,
      entity_a:entity_a_id(id, name, type, risk_level)
    `)
    .eq("entity_b_id", entity.id);

  // Get travel data if linked to a traveler
  const { data: traveler } = await supabase
    .from("travelers")
    .select(`
      id, name, email,
      itineraries(id, trip_name, destination_country, destination_city, departure_date, return_date, risk_level, status)
    `)
    .ilike("name", `%${entity.name}%`)
    .limit(1)
    .maybeSingle();

  // Get alert preferences
  const { data: alertPrefs } = await supabase
    .from("principal_alert_preferences")
    .select("*")
    .eq("entity_id", entity.id)
    .maybeSingle();

  // Get recent entity content (sentiment)
  const { data: recentContent } = await supabase
    .from("entity_content")
    .select("id, title, sentiment, source, published_date, relevance_score")
    .eq("entity_id", entity.id)
    .order("published_date", { ascending: false })
    .limit(20);

  // Parse attributes from VIP deep scan
  const attrs = entity.attributes || {};

  // Categorize relationships
  const familyMembers = (relationships || [])
    .filter((r: any) => ["family", "spouse", "child", "parent", "sibling"].includes(r.relationship_type?.toLowerCase()))
    .map((r: any) => ({
      name: r.entity_b?.name,
      relationship: r.relationship_type,
      risk_level: r.entity_b?.risk_level
    }));

  const adversaries = (relationships || [])
    .filter((r: any) => ["adversary", "competitor", "threat", "hostile"].includes(r.relationship_type?.toLowerCase()))
    .map((r: any) => ({
      name: r.entity_b?.name,
      relationship: r.relationship_type,
      threat_level: r.entity_b?.risk_level || r.strength > 0.7 ? "high" : "medium"
    }));

  // Calculate alert stats (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: alertCount } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true })
    .contains("auto_correlated_entities", [entity.id])
    .gte("created_at", thirtyDaysAgo);

  return {
    profile_summary: {
      id: entity.id,
      name: entity.name,
      aliases: entity.aliases || [],
      nationality: attrs.nationality || attrs.country || null,
      dob: attrs.date_of_birth || attrs.dob || null,
      risk_level: entity.risk_level,
      threat_score: entity.threat_score
    },
    travel_patterns: {
      frequent_destinations: attrs.travel_patterns?.frequent_destinations || [],
      upcoming_trips: traveler?.itineraries?.filter((i: any) => i.status !== "completed") || [],
      preferred_airlines: attrs.travel_patterns?.preferred_airlines || []
    },
    properties: attrs.properties || [],
    known_adversaries: adversaries,
    family_members: familyMembers,
    digital_footprint: {
      social_handles: attrs.social_media || {},
      email_providers: attrs.email_providers || [],
      cloud_services: attrs.cloud_services || []
    },
    movement_patterns: {
      regular_routes: attrs.movement_patterns?.regular_routes || [],
      frequented_locations: attrs.movement_patterns?.frequented_locations || []
    },
    threat_profile: {
      specific_concerns: attrs.threat_concerns || [],
      industry_threats: attrs.industry_threats || [],
      previous_incidents: attrs.previous_incidents || []
    },
    active_monitoring: {
      enabled: entity.active_monitoring_enabled,
      radius_km: entity.monitoring_radius_km,
      alert_count_30d: alertCount || 0
    },
    risk_appetite: alertPrefs ? {
      threshold: alertPrefs.alert_threshold,
      risk_appetite: alertPrefs.risk_appetite,
      quiet_hours: alertPrefs.quiet_hours
    } : null,
    recent_sentiment: recentContent?.slice(0, 5) || []
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { entity_id, scenario_type, hypothetical } = await req.json();
    
    if (!entity_id) {
      return errorResponse("entity_id is required", 400);
    }

    const supabase = createServiceClient();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    // Get principal profile
    const principalProfile = await getPrincipalProfile(supabase, entity_id);
    if (principalProfile.error) {
      return errorResponse(principalProfile.error, 404);
    }

    // Build scenario context
    const scenarioContext = {
      scenario_type: scenario_type || "combined",
      hypothetical: hypothetical || {},
      principal: principalProfile
    };

    // Get destination threat data if travel scenario
    let destinationAnalysis = null;
    if ((scenario_type === "travel" || scenario_type === "combined") && hypothetical?.destination) {
      // Query for signals related to destination
      const { data: destSignals } = await supabase
        .from("signals")
        .select("id, title, severity, rule_category, created_at")
        .or(`normalized_text.ilike.%${hypothetical.destination}%,title.ilike.%${hypothetical.destination}%`)
        .order("created_at", { ascending: false })
        .limit(20);

      // Check itineraries for travel risk assessments
      const { data: destItineraries } = await supabase
        .from("itineraries")
        .select("risk_level, risk_assessment, destination_country, destination_city")
        .or(`destination_country.ilike.%${hypothetical.destination}%,destination_city.ilike.%${hypothetical.destination}%`)
        .order("created_at", { ascending: false })
        .limit(10);

      destinationAnalysis = {
        destination: hypothetical.destination,
        signal_count: destSignals?.length || 0,
        recent_signals: destSignals?.slice(0, 5) || [],
        historical_risk_levels: destItineraries?.map((i: any) => i.risk_level) || [],
        risk_assessments: destItineraries?.filter((i: any) => i.risk_assessment)?.slice(0, 3) || []
      };
    }

    // Cross-reference adversaries with destination
    const adversaryOverlap = principalProfile.known_adversaries?.filter((adv: any) => {
      if (!hypothetical?.destination) return false;
      return adv.name?.toLowerCase().includes(hypothetical.destination.toLowerCase());
    }) || [];

    // Call AI to synthesize scenario impact
    let aiAnalysis = null;
    if (GEMINI_API_KEY) {
      const prompt = `You are a corporate security intelligence analyst. Analyze this what-if scenario for a VIP principal:

PRINCIPAL PROFILE:
${JSON.stringify(principalProfile.profile_summary, null, 2)}

KNOWN ADVERSARIES:
${JSON.stringify(principalProfile.known_adversaries, null, 2)}

PROPERTIES:
${JSON.stringify(principalProfile.properties, null, 2)}

THREAT PROFILE:
${JSON.stringify(principalProfile.threat_profile, null, 2)}

SCENARIO TYPE: ${scenario_type || "combined"}

HYPOTHETICAL SITUATION:
${JSON.stringify(hypothetical, null, 2)}

${destinationAnalysis ? `DESTINATION INTELLIGENCE:\n${JSON.stringify(destinationAnalysis, null, 2)}` : ""}

${adversaryOverlap.length > 0 ? `WARNING - ADVERSARY OVERLAP WITH DESTINATION:\n${JSON.stringify(adversaryOverlap, null, 2)}` : ""}

Provide a structured scenario assessment with:
1. SCENARIO DESCRIPTION: Brief summary of the hypothetical situation
2. IMPACT ASSESSMENT:
   - Physical Security (level: low/medium/high/critical, key factors)
   - Reputational Risk (level: low/medium/high/critical, key factors)
   - Operational Impact (level: low/medium/high/critical, key factors)
3. RECOMMENDATIONS: Array of specific actions with priority (immediate/short-term/long-term) and rationale
4. ESCALATION TRIGGERS: Conditions that would require immediate response
5. SIMULATION CONFIDENCE: 0-100 score based on data quality

Format your response as valid JSON.`;

      try {
        const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a corporate security analyst. Respond only with valid JSON." },
              { role: "user", content: prompt }
            ],
            temperature: 0.4,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          // Try to parse JSON from the response
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              aiAnalysis = JSON.parse(jsonMatch[0]);
            }
          } catch {
            aiAnalysis = { raw_analysis: content };
          }
        }
      } catch (error) {
        console.error("AI analysis error:", error);
      }
    }

    const profileSummary = principalProfile.profile_summary as { name: string; id: string } | undefined;
    const response = {
      success: true,
      scenario_type: scenario_type || "combined",
      scenario_description: aiAnalysis?.scenario_description || `What-if analysis for ${profileSummary?.name || "Unknown Principal"}`,
      principal_context: {
        name: profileSummary?.name || "Unknown",
        travel_patterns: principalProfile.travel_patterns,
        known_adversaries: principalProfile.known_adversaries,
        properties: principalProfile.properties
      },
      destination_analysis: destinationAnalysis,
      adversary_overlap: adversaryOverlap,
      impact_assessment: aiAnalysis?.impact_assessment || {
        physical_security: { level: "medium", factors: ["Insufficient data for detailed assessment"] },
        reputational: { level: "medium", factors: ["Insufficient data for detailed assessment"] },
        operational: { level: "medium", factors: ["Insufficient data for detailed assessment"] }
      },
      recommendations: aiAnalysis?.recommendations || [
        { action: "Conduct pre-travel security briefing", priority: "immediate", rationale: "Standard protocol for travel scenarios" }
      ],
      escalation_triggers: aiAnalysis?.escalation_triggers || [
        "Credible threat intelligence received",
        "Security incident at destination"
      ],
      simulation_confidence: aiAnalysis?.simulation_confidence || 50
    };

    return successResponse(response);

  } catch (error) {
    console.error("What-if scenario error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
