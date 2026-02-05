import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Get active itineraries that need monitoring
    const { data: itineraries, error: itinerariesError } = await supabaseClient
      .from("itineraries")
      .select(`
        *,
        travelers:traveler_id (*)
      `)
      .eq("monitoring_enabled", true)
      .in("status", ["upcoming", "active"]);

    if (itinerariesError) throw itinerariesError;

    console.log(`Monitoring ${itineraries?.length || 0} active itineraries`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Process each itinerary with AI risk assessment
    for (const itinerary of itineraries || []) {
      const traveler = itinerary.travelers;
      
      // Query Fortress intelligence data for destination
      const destinationCountry = itinerary.destination_country;
      const destinationCity = itinerary.destination_city;
      const departureDate = itinerary.departure_date;
      const returnDate = itinerary.return_date;
      
      // Build location search terms
      const locationTerms = [
        destinationCountry,
        destinationCity,
        `${destinationCity}, ${destinationCountry}`,
      ].filter(Boolean);
      
      // Query recent signals related to destination (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: relevantSignals } = await supabaseClient
        .from("signals")
        .select("title, content, category, severity, source_type, created_at, location")
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      
      // Query weather-related signals
      const { data: weatherSignals } = await supabaseClient
        .from("signals")
        .select("title, content, severity, created_at, location")
        .or(`category.eq.weather,category.eq.natural_disaster,source_type.eq.weather`)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(20);
      
      // Query security/threat signals
      const { data: securitySignals } = await supabaseClient
        .from("signals")
        .select("title, content, severity, created_at, location, source_type")
        .or(`category.eq.security,category.eq.threat,category.eq.terrorism,category.eq.civil_unrest,category.eq.crime`)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(30);
      
      // Query geopolitical/political signals
      const { data: geopoliticalSignals } = await supabaseClient
        .from("signals")
        .select("title, content, severity, created_at, location")
        .or(`category.eq.geopolitical,category.eq.political,category.eq.government,category.eq.regulatory`)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(20);
      
      // Query health-related signals
      const { data: healthSignals } = await supabaseClient
        .from("signals")
        .select("title, content, severity, created_at, location")
        .or(`category.eq.health,category.eq.pandemic,category.eq.disease`)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(15);
      
      // Query infrastructure/transportation signals
      const { data: infrastructureSignals } = await supabaseClient
        .from("signals")
        .select("title, content, severity, created_at, location")
        .or(`category.eq.infrastructure,category.eq.transportation,category.eq.aviation`)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(15);
      
      // Query active incidents in destination area
      const { data: activeIncidents } = await supabaseClient
        .from("incidents")
        .select("title, description, severity, status, created_at, location")
        .in("status", ["open", "investigating", "active"])
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .limit(10);
      
      // Query travel alerts for this region (from our own system)
      const { data: existingAlerts } = await supabaseClient
        .from("travel_alerts")
        .select("title, description, severity, alert_type, location, created_at")
        .eq("is_active", true)
        .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
        .limit(10);
      
      // Format intelligence data for AI
      const formatSignals = (signals: any[] | null, label: string) => {
        if (!signals || signals.length === 0) return `No recent ${label} intelligence.`;
        return signals.map(s => 
          `- [${s.severity?.toUpperCase() || 'INFO'}] ${s.title} (${new Date(s.created_at).toLocaleDateString()}): ${s.content?.substring(0, 200) || 'No details'}${s.location ? ` | Location: ${s.location}` : ''}`
        ).join('\n');
      };

      // Prepare context for AI analysis
      const context = {
        trip: {
          name: itinerary.trip_name,
          type: itinerary.trip_type,
          departure: itinerary.departure_date,
          return: itinerary.return_date,
          origin: `${itinerary.origin_city}, ${itinerary.origin_country}`,
          destination: `${itinerary.destination_city}, ${itinerary.destination_country}`,
          flights: itinerary.flight_numbers,
          hotel: itinerary.hotel_name,
        },
        traveler: {
          name: traveler?.name,
          current_location: traveler?.current_location,
        },
      };

      const prompt = `Analyze this business travel itinerary for potential risks using BOTH the Fortress intelligence data provided AND your knowledge of current world conditions:

=== TRIP DETAILS ===
- Name: ${context.trip.name}
- Type: ${context.trip.type}
- Departure: ${context.trip.departure}
- Return: ${context.trip.return}
- Route: ${context.trip.origin} → ${context.trip.destination}
- Flights: ${context.trip.flights?.join(", ") || "Not specified"}
- Hotel: ${context.trip.hotel || "Not specified"}

Traveler: ${context.traveler.name}
Current Location: ${context.traveler.current_location || "Unknown"}

=== FORTRESS INTELLIGENCE DATA ===

📍 DESTINATION SIGNALS (${relevantSignals?.length || 0} items):
${formatSignals(relevantSignals, "destination")}

🌦️ WEATHER & NATURAL DISASTER INTELLIGENCE (${weatherSignals?.length || 0} items):
${formatSignals(weatherSignals, "weather/disaster")}

🔒 SECURITY & THREAT INTELLIGENCE (${securitySignals?.length || 0} items):
${formatSignals(securitySignals, "security/threat")}

🌍 GEOPOLITICAL INTELLIGENCE (${geopoliticalSignals?.length || 0} items):
${formatSignals(geopoliticalSignals, "geopolitical")}

🏥 HEALTH INTELLIGENCE (${healthSignals?.length || 0} items):
${formatSignals(healthSignals, "health")}

🚧 INFRASTRUCTURE & TRANSPORTATION (${infrastructureSignals?.length || 0} items):
${formatSignals(infrastructureSignals, "infrastructure")}

⚠️ ACTIVE INCIDENTS IN REGION (${activeIncidents?.length || 0} items):
${activeIncidents?.map(i => `- [${i.severity?.toUpperCase()}] ${i.title}: ${i.description?.substring(0, 150) || 'No details'}`).join('\n') || 'No active incidents.'}

🔔 EXISTING TRAVEL ALERTS (${existingAlerts?.length || 0} items):
${existingAlerts?.map(a => `- [${a.severity?.toUpperCase()}] ${a.alert_type}: ${a.title}`).join('\n') || 'No existing alerts.'}

=== ANALYSIS REQUIREMENTS ===

Synthesize the Fortress intelligence data above with your knowledge to assess:

1. **Flight Risks**: 
   - Weather conditions affecting departure/arrival airports
   - Known airline operational issues or strikes
   - Airport disruptions or closures

2. **Destination-Specific Security Risks**:
   - Active security threats from intelligence data
   - Political stability and civil unrest indicators
   - Crime patterns and safety concerns
   - Terrorism risk level

3. **Weather & Natural Disasters**:
   - Current weather warnings from Fortress data
   - Seasonal weather patterns for travel dates
   - Hurricane/typhoon/monsoon season risks
   - Earthquake/volcanic activity
   - Wildfire risks

4. **Health & Safety**:
   - Disease outbreaks from health intelligence
   - Vaccination requirements
   - Medical facility accessibility
   - Water/food safety

5. **Geopolitical Factors**:
   - Government travel advisories
   - Diplomatic tensions
   - Economic instability
   - Regulatory changes affecting travelers

6. **Infrastructure & Transportation**:
   - Ground transportation reliability
   - Hotel area safety
   - Communication infrastructure
   - Power/utility stability

PRIORITIZE alerts from Fortress intelligence data. Only create alerts for GENUINE risks - do not fabricate hypothetical scenarios.

Respond with a JSON object:
{
  "risk_level": "low|medium|high|critical",
  "alerts": [
    {
      "type": "flight_delay|flight_cancellation|weather|security|health|natural_disaster|infrastructure|geopolitical|other",
      "severity": "low|medium|high|critical",
      "title": "Brief title",
      "description": "Detailed description citing specific Fortress intelligence or verified information",
      "location": "Affected location",
      "affected_flights": ["flight codes if applicable"],
      "recommended_actions": ["Specific actionable steps"],
      "source": "Fortress Intelligence|AI Assessment|Combined Analysis",
      "fortress_signal_count": 0
    }
  ],
  "assessment": "Overall risk assessment summary with specific references to Fortress intelligence data",
  "data_sources_analyzed": {
    "destination_signals": ${relevantSignals?.length || 0},
    "weather_signals": ${weatherSignals?.length || 0},
    "security_signals": ${securitySignals?.length || 0},
    "geopolitical_signals": ${geopoliticalSignals?.length || 0},
    "health_signals": ${healthSignals?.length || 0},
    "infrastructure_signals": ${infrastructureSignals?.length || 0},
    "active_incidents": ${activeIncidents?.length || 0}
  }
}`;

      // Call AI for risk assessment
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You are a travel risk analyst with access to current world events, weather patterns, and travel advisories. Provide REALISTIC risk assessments based on ACTUAL conditions at the destination. Only create alerts for genuine, verified risks - not hypothetical scenarios. Focus on destination-specific threats, route-specific issues, and time-sensitive concerns. If the destination is generally safe with no current threats, indicate low risk.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "assess_travel_risks",
                description: "Assess risks for a business travel itinerary",
                parameters: {
                  type: "object",
                  properties: {
                    risk_level: {
                      type: "string",
                      enum: ["low", "medium", "high", "critical"],
                    },
                    alerts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: {
                            type: "string",
                            enum: ["flight_delay", "flight_cancellation", "weather", "security", "health", "natural_disaster", "infrastructure", "other"],
                          },
                          severity: {
                            type: "string",
                            enum: ["low", "medium", "high", "critical"],
                          },
                          title: { type: "string" },
                          description: { type: "string" },
                          location: { type: "string" },
                          affected_flights: {
                            type: "array",
                            items: { type: "string" },
                          },
                          recommended_actions: {
                            type: "array",
                            items: { type: "string" },
                          },
                          source: { type: "string" },
                        },
                        required: ["type", "severity", "title", "description"],
                      },
                    },
                    assessment: { type: "string" },
                  },
                  required: ["risk_level", "alerts", "assessment"],
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "assess_travel_risks" },
          },
        }),
      });

      if (!aiResponse.ok) {
        console.error(`AI analysis failed for itinerary ${itinerary.id}:`, await aiResponse.text());
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      
      if (!toolCall) {
        console.log(`No risk assessment generated for itinerary ${itinerary.id}`);
        continue;
      }

      const assessment = JSON.parse(toolCall.function.arguments);

      console.log(`Risk assessment for ${itinerary.trip_name}:`, {
        risk_level: assessment.risk_level,
        alert_count: assessment.alerts?.length || 0,
        alerts: assessment.alerts?.map((a: any) => ({ 
          type: a.type, 
          severity: a.severity, 
          title: a.title 
        }))
      });

      // Update itinerary with AI risk assessment
      await supabaseClient
        .from("itineraries")
        .update({
          risk_level: assessment.risk_level,
          ai_risk_assessment: assessment,
        })
        .eq("id", itinerary.id);

      // Create alerts for significant risks
      if (assessment.alerts && assessment.alerts.length > 0) {
        for (const alert of assessment.alerts) {
          // Only create alerts for medium severity and above
          if (["medium", "high", "critical"].includes(alert.severity)) {
            await supabaseClient.from("travel_alerts").insert({
              itinerary_id: itinerary.id,
              traveler_id: itinerary.traveler_id,
              alert_type: alert.type,
              severity: alert.severity,
              title: alert.title,
              description: alert.description,
              location: alert.location || null,
              affected_flights: alert.affected_flights || [],
              recommended_actions: alert.recommended_actions || [],
              source: alert.source || "AI Risk Assessment",
            });
          }
        }
      }

      console.log(`Updated risk assessment for itinerary ${itinerary.id}: ${assessment.risk_level}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        monitored: itineraries?.length || 0,
        message: "Travel risk monitoring completed",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in travel risk monitoring:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
