import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

// Track Perplexity failures per invocation to avoid duplicate warnings
let perplexityFailureLogged = false;

async function logPerplexityFailure(status: number, source: string) {
  if (perplexityFailureLogged) return;
  perplexityFailureLogged = true;
  
  const isCredits = status === 401 || status === 403;
  const isRateLimit = status === 429;
  
  const message = isCredits
    ? `Perplexity API credentials rejected (HTTP ${status}). Likely expired API key or exhausted credits. Real-time travel intelligence is degraded — falling back to AI gateway.`
    : isRateLimit
    ? `Perplexity API rate limited (HTTP ${status}). Too many requests. Real-time travel intelligence temporarily degraded.`
    : `Perplexity API returned unexpected HTTP ${status}. Real-time intelligence may be degraded.`;

  console.error(`[PERPLEXITY ALERT] ${message}`);
  
  await logError(new Error(message), {
    functionName: 'monitor-travel-risks',
    severity: isCredits ? 'critical' : 'warning',
    requestContext: {
      source,
      httpStatus: status,
      apiProvider: 'perplexity',
      issue: isCredits ? 'api_credits_exhausted' : isRateLimit ? 'rate_limited' : 'unknown',
      recommendation: isCredits 
        ? 'Top up Perplexity API credits at https://perplexity.ai/settings/api' 
        : 'Reduce scan frequency or wait for rate limit reset',
    },
  });
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  perplexityFailureLogged = false; // Reset per invocation
  try {
    const supabaseClient = createServiceClient();

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY"); // Still needed for Perplexity helper check
    
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    
    // Helper function to get real-time flight status via Perplexity (with AI gateway fallback)
    async function getFlightStatus(flightNumbers: string[], departureDate: string): Promise<any> {
      if (!flightNumbers || flightNumbers.length === 0) {
        return null;
      }
      
      const flightQuery = flightNumbers.join(", ");
      const flightPrompt = `Get the current real-time status for these flights scheduled around ${departureDate}: ${flightQuery}

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

Return as JSON: { "flights": [...], "airport_conditions": {...}, "weather_impacts": [...] }`;

      // Try Perplexity first
      if (PERPLEXITY_API_KEY) {
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
                { role: "system", content: "You are a flight status analyst. Provide accurate, real-time flight status information. Return structured JSON data only." },
                { role: "user", content: flightPrompt }
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "flight_status",
                  schema: {
                    type: "object",
                    properties: {
                      flights: { type: "array", items: { type: "object", properties: { flight_number: { type: "string" }, airline: { type: "string" }, origin: { type: "string" }, destination: { type: "string" }, scheduled_departure: { type: "string" }, actual_departure: { type: "string" }, status: { type: "string" }, delay_minutes: { type: "number" }, delay_reason: { type: "string" }, gate: { type: "string" } } } },
                      airport_conditions: { type: "object", properties: { delays: { type: "array", items: { type: "string" } }, closures: { type: "array", items: { type: "string" } }, weather_alerts: { type: "array", items: { type: "string" } } } },
                      weather_impacts: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            const citations = data.citations || [];
            if (content) {
              try {
                const parsed = JSON.parse(content);
                parsed.citations = citations;
                console.log("Flight status retrieved via Perplexity");
                return parsed;
              } catch { return { citations }; }
            }
            return { citations };
          } else {
            console.warn(`Perplexity flight status returned ${response.status}, falling back to AI gateway`);
            await response.text(); // consume body
            await logPerplexityFailure(response.status, 'flight_status');
          }
        } catch (error) {
          console.warn("Perplexity flight status failed, falling back to AI gateway:", error);
        }
      }

      // Fallback: use AI gateway with web-search-capable model
      try {
        const fallbackResult = await callAiGateway({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: "system", content: "You are a flight status analyst. Use your knowledge of current airline schedules and conditions to provide the best available flight status information. Return valid JSON only, no markdown." },
            { role: "user", content: flightPrompt }
          ],
          functionName: 'monitor-travel-risks',
          retries: 1,
        });
        if (!fallbackResult.error && fallbackResult.text) {
          try {
            const cleaned = fallbackResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleaned);
            parsed.citations = [];
            parsed.source = "ai-gateway-fallback";
            console.log("Flight status retrieved via AI gateway fallback");
            return parsed;
          } catch { console.warn("Failed to parse AI gateway flight status response"); }
        }
      } catch (error) {
        console.error("AI gateway flight status fallback also failed:", error);
      }
      return null;
    }
    
    // Helper function to get destination intelligence via Perplexity (with AI gateway fallback)
    async function getDestinationIntelligence(city: string, country: string, travelDates: string): Promise<any> {
      const destPrompt = `Provide current travel intelligence for ${city}, ${country} for travel around ${travelDates}:

1. Current travel advisories and safety level
2. Recent security incidents or threats (last 7 days)
3. Current weather conditions and forecasts
4. Active protests, strikes, or civil unrest
5. Health alerts or disease outbreaks
6. Infrastructure issues (transportation strikes, airport conditions)
7. Major events that could affect travel
8. Current geopolitical situation

Return as JSON: { "safety_level": "low|medium|high|critical", "advisories": [...], "current_threats": [...], "weather": {...}, "civil_unrest": [...], "health_alerts": [...], "infrastructure": [...], "events": [...], "geopolitical": {...} }`;

      // Try Perplexity first
      if (PERPLEXITY_API_KEY) {
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
                { role: "system", content: "You are a travel security analyst providing real-time destination intelligence. Focus on current events, safety conditions, and travel advisories. Return structured JSON only." },
                { role: "user", content: destPrompt }
              ],
              search_recency_filter: "week",
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log("Destination intel retrieved via Perplexity");
            return {
              content: data.choices?.[0]?.message?.content,
              citations: data.citations || []
            };
          } else {
            console.warn(`Perplexity destination intel returned ${response.status}, falling back to AI gateway`);
            await response.text(); // consume body
            await logPerplexityFailure(response.status, 'destination_intel');
          }
        } catch (error) {
          console.warn("Perplexity destination intel failed, falling back to AI gateway:", error);
        }
      }

      // Fallback: use AI gateway
      try {
        const fallbackResult = await callAiGateway({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: "system", content: "You are a travel security analyst. Using your knowledge of current world events, provide the most up-to-date destination intelligence. Focus on real, verifiable conditions. Return detailed analysis as prose, not JSON." },
            { role: "user", content: `Provide current travel security intelligence for ${city}, ${country} for travel around ${travelDates}. Cover: travel advisories, weather conditions, security threats, civil unrest, health risks, infrastructure issues, and any major events affecting travel. Be specific about current conditions.` }
          ],
          functionName: 'monitor-travel-risks',
          retries: 1,
        });
        if (!fallbackResult.error && fallbackResult.text) {
          console.log("Destination intel retrieved via AI gateway fallback");
          return {
            content: fallbackResult.text,
            citations: [],
            source: "ai-gateway-fallback"
          };
        }
      } catch (error) {
        console.error("AI gateway destination intel fallback also failed:", error);
      }
      return null;
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

      // Call AI for risk assessment via resilient gateway
      const aiResult = await callAiGateway({
        model: 'google/gemini-2.5-flash',
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
        functionName: 'monitor-travel-risks',
        retries: 2,
        extraBody: {
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
        },
      });

      if (aiResult.error) {
        console.error(`AI analysis failed for itinerary ${itinerary.id}:`, aiResult.error);
        continue;
      }

      const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
      
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

      // Capture previous risk level for change detection
      const previousRiskLevel = itinerary.risk_level || "low";
      const riskChanged = previousRiskLevel !== assessment.risk_level;

      // Update itinerary with AI risk assessment
      await supabaseClient
        .from("itineraries")
        .update({
          risk_level: assessment.risk_level,
          ai_risk_assessment: assessment,
        })
        .eq("id", itinerary.id);

      // Log scan to history for timeline rendering
      await supabaseClient.from("itinerary_scan_history").insert({
        itinerary_id: itinerary.id,
        risk_level: assessment.risk_level,
        alert_count: assessment.alerts?.length || 0,
        alerts: assessment.alerts || [],
        flight_status: flightStatus || null,
        destination_intel_summary: assessment.assessment || null,
        previous_risk_level: previousRiskLevel,
        risk_changed: riskChanged,
        scan_source: "automated",
      });

      // Create alerts for significant risks (skip if similar alert already exists and is acknowledged)
      if (assessment.alerts && assessment.alerts.length > 0) {
        for (const alert of assessment.alerts) {
          // Only create alerts for medium severity and above
          if (["medium", "high", "critical"].includes(alert.severity)) {
            // Check for existing alert of the same type for this itinerary (active OR acknowledged)
            const { data: existingAlerts } = await supabaseClient
              .from("travel_alerts")
              .select("id, acknowledged, is_active, created_at")
              .eq("itinerary_id", itinerary.id)
              .eq("alert_type", alert.type)
              .order("created_at", { ascending: false })
              .limit(1);

            const existingAlert = existingAlerts?.[0];

            // Skip if an alert of this type already exists (acknowledged or not)
            if (existingAlert) {
              console.log(`Skipping duplicate ${alert.type} alert for itinerary ${itinerary.id} (existing: ${existingAlert.id}, acknowledged: ${existingAlert.acknowledged})`);
              continue;
            }

            // Collect citation URLs from Perplexity responses
            const citationUrls: string[] = [];
            if (destinationIntel?.citations?.length) {
              citationUrls.push(...destinationIntel.citations.slice(0, 5));
            }
            if (flightStatus?.citations?.length) {
              citationUrls.push(...flightStatus.citations.slice(0, 3));
            }

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
              source_urls: citationUrls.length > 0 ? citationUrls : [],
            });
          }
        }
      }

      console.log(`Updated risk assessment for itinerary ${itinerary.id}: ${assessment.risk_level}${riskChanged ? ` (changed from ${previousRiskLevel})` : ""}`);
    }

    return successResponse({
      success: true,
      monitored: itineraries?.length || 0,
      message: "Travel risk monitoring completed",
    });
  } catch (error) {
    console.error("Error in travel risk monitoring:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
