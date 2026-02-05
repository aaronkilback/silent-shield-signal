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
    
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    
    // Helper function to get real-time flight status via Perplexity
    async function getFlightStatus(flightNumbers: string[], departureDate: string): Promise<any> {
      if (!PERPLEXITY_API_KEY || !flightNumbers || flightNumbers.length === 0) {
        return null;
      }
      
      try {
        const flightQuery = flightNumbers.join(", ");
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content: "You are a flight status analyst. Provide accurate, real-time flight status information. Return structured JSON data only."
              },
              {
                role: "user",
                content: `Get the current real-time status for these flights scheduled around ${departureDate}: ${flightQuery}

For each flight, provide:
- Flight number
- Airline
- Route (origin → destination airports)
- Scheduled departure time
- Actual/estimated departure time
- Status (on-time, delayed, cancelled, diverted, landed, in-flight)
- Delay duration if applicable
- Gate information if available
- Any disruption reasons (weather, mechanical, crew, etc.)

Return as JSON: { "flights": [...], "airport_conditions": {...}, "weather_impacts": [...] }`
              }
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "flight_status",
                schema: {
                  type: "object",
                  properties: {
                    flights: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          flight_number: { type: "string" },
                          airline: { type: "string" },
                          origin: { type: "string" },
                          destination: { type: "string" },
                          scheduled_departure: { type: "string" },
                          actual_departure: { type: "string" },
                          status: { type: "string" },
                          delay_minutes: { type: "number" },
                          delay_reason: { type: "string" },
                          gate: { type: "string" }
                        }
                      }
                    },
                    airport_conditions: {
                      type: "object",
                      properties: {
                        delays: { type: "array", items: { type: "string" } },
                        closures: { type: "array", items: { type: "string" } },
                        weather_alerts: { type: "array", items: { type: "string" } }
                      }
                    },
                    weather_impacts: {
                      type: "array",
                      items: { type: "string" }
                    }
                  }
                }
              }
            }
          }),
        });
        
        if (!response.ok) {
          console.error("Perplexity flight status error:", await response.text());
          return null;
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (content) {
          try {
            return JSON.parse(content);
          } catch {
            console.error("Failed to parse flight status JSON");
            return null;
          }
        }
        return null;
      } catch (error) {
        console.error("Error fetching flight status:", error);
        return null;
      }
    }
    
    // Helper function to get destination intelligence via Perplexity
    async function getDestinationIntelligence(city: string, country: string, travelDates: string): Promise<any> {
      if (!PERPLEXITY_API_KEY) {
        return null;
      }
      
      try {
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content: "You are a travel security analyst providing real-time destination intelligence. Focus on current events, safety conditions, and travel advisories. Return structured JSON only."
              },
              {
                role: "user",
                content: `Provide current travel intelligence for ${city}, ${country} for travel around ${travelDates}:

1. Current travel advisories and safety level
2. Recent security incidents or threats (last 7 days)
3. Current weather conditions and forecasts
4. Active protests, strikes, or civil unrest
5. Health alerts or disease outbreaks
6. Infrastructure issues (transportation strikes, airport conditions)
7. Major events that could affect travel
8. Current geopolitical situation

Return as JSON: { "safety_level": "low|medium|high|critical", "advisories": [...], "current_threats": [...], "weather": {...}, "civil_unrest": [...], "health_alerts": [...], "infrastructure": [...], "events": [...], "geopolitical": {...} }`
              }
            ],
            search_recency_filter: "week",
          }),
        });
        
        if (!response.ok) {
          console.error("Perplexity destination intel error:", await response.text());
          return null;
        }
        
        const data = await response.json();
        return {
          content: data.choices?.[0]?.message?.content,
          citations: data.citations || []
        };
      } catch (error) {
        console.error("Error fetching destination intelligence:", error);
        return null;
      }
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
      
      // Fetch real-time flight status via Perplexity
      const flightStatus = await getFlightStatus(
        itinerary.flight_numbers || [],
        departureDate
      );
      
      // Fetch real-time destination intelligence via Perplexity
      const destinationIntel = await getDestinationIntelligence(
        destinationCity,
        destinationCountry,
        `${departureDate} to ${returnDate}`
      );
      
      console.log("=== PERPLEXITY DATA ===");
      console.log("Flight status:", flightStatus ? "Retrieved" : "Not available");
      console.log("Destination intel:", destinationIntel ? "Retrieved" : "Not available");
      
      // Format intelligence data for AI
      const formatSignals = (signals: any[] | null, label: string) => {
        if (!signals || signals.length === 0) return `No recent ${label} intelligence.`;
        return signals.map(s => 
          `- [${s.severity?.toUpperCase() || 'INFO'}] ${s.title} (${new Date(s.created_at).toLocaleDateString()}): ${s.content?.substring(0, 200) || 'No details'}${s.location ? ` | Location: ${s.location}` : ''}`
        ).join('\n');
      };
      
      // Format flight status data
      const formatFlightStatus = () => {
        if (!flightStatus?.flights || flightStatus.flights.length === 0) {
          return "No real-time flight data available.";
        }
        return flightStatus.flights.map((f: any) => 
          `- ${f.flight_number} (${f.airline}): ${f.origin} → ${f.destination}
     Status: ${f.status?.toUpperCase() || 'UNKNOWN'}
     Scheduled: ${f.scheduled_departure || 'N/A'} | Actual: ${f.actual_departure || 'N/A'}
     ${f.delay_minutes ? `Delay: ${f.delay_minutes} minutes (${f.delay_reason || 'Unknown reason'})` : ''}
     ${f.gate ? `Gate: ${f.gate}` : ''}`
        ).join('\n');
      };
      
      // Format airport conditions
      const formatAirportConditions = () => {
        if (!flightStatus?.airport_conditions) return "No airport conditions data.";
        const conditions = flightStatus.airport_conditions;
        const parts = [];
        if (conditions.delays?.length) parts.push(`Delays: ${conditions.delays.join(', ')}`);
        if (conditions.closures?.length) parts.push(`Closures: ${conditions.closures.join(', ')}`);
        if (conditions.weather_alerts?.length) parts.push(`Weather Alerts: ${conditions.weather_alerts.join(', ')}`);
        return parts.length > 0 ? parts.join('\n') : "No significant airport conditions.";
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

      const prompt = `Analyze this business travel itinerary for potential risks using ALL intelligence data provided:

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

=== REAL-TIME FLIGHT STATUS (via Perplexity) ===
✈️ FLIGHT STATUS:
${formatFlightStatus()}

🛫 AIRPORT CONDITIONS:
${formatAirportConditions()}

🌤️ WEATHER IMPACTS:
${flightStatus?.weather_impacts?.join('\n') || 'No weather impact data.'}

=== REAL-TIME DESTINATION INTELLIGENCE (via Perplexity) ===
${destinationIntel?.content || 'No real-time destination intelligence available.'}

${destinationIntel?.citations?.length ? `Sources: ${destinationIntel.citations.slice(0, 5).join(', ')}` : ''}

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

Synthesize ALL data sources (real-time Perplexity data + Fortress intelligence) to assess:

1. **Flight Risks** (PRIORITY - use real-time flight status data):
   - Current flight delays or cancellations from Perplexity data
   - Weather conditions affecting departure/arrival airports
   - Known airline operational issues or strikes
   - Airport disruptions or closures

2. **Destination-Specific Security Risks**:
   - Active security threats from intelligence data
   - Political stability and civil unrest indicators
   - Crime patterns and safety concerns
   - Terrorism risk level

3. **Weather & Natural Disasters**:
   - Current weather warnings from Fortress and Perplexity data
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

PRIORITIZE real-time flight status data from Perplexity when available. Create alerts for GENUINE risks based on verified data.

Respond with a JSON object:
{
  "risk_level": "low|medium|high|critical",
  "alerts": [
    {
      "type": "flight_delay|flight_cancellation|weather|security|health|natural_disaster|infrastructure|geopolitical|other",
      "severity": "low|medium|high|critical",
      "title": "Brief title",
      "description": "Detailed description citing specific data sources",
      "location": "Affected location",
      "affected_flights": ["flight codes if applicable"],
      "recommended_actions": ["Specific actionable steps"],
      "source": "Perplexity Real-Time|Fortress Intelligence|Combined Analysis",
      "fortress_signal_count": 0
    }
  ],
  "assessment": "Overall risk assessment summary with specific data references",
  "data_sources_analyzed": {
    "perplexity_flight_status": ${flightStatus ? "true" : "false"},
    "perplexity_destination_intel": ${destinationIntel ? "true" : "false"},
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
