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

      const prompt = `Analyze this business travel itinerary for potential risks and disruptions based on CURRENT real-world conditions:

Trip Details:
- Name: ${context.trip.name}
- Type: ${context.trip.type}
- Departure: ${context.trip.departure}
- Return: ${context.trip.return}
- Route: ${context.trip.origin} → ${context.trip.destination}
- Flights: ${context.trip.flights?.join(", ") || "Not specified"}
- Hotel: ${context.trip.hotel || "Not specified"}

Traveler: ${context.traveler.name}
Current Location: ${context.traveler.current_location || "Unknown"}

Analyze SPECIFIC risks for THIS travel route and destination:

1. **Flight Risks**: 
   - Check for known delays/cancellations on these specific flight routes
   - Weather conditions affecting departure/arrival airports
   - Airline operational issues

2. **Destination-Specific Risks**:
   - Security alerts or travel advisories for ${context.trip.destination}
   - Political stability and civil unrest
   - Crime rates in destination city
   - Local health concerns or disease outbreaks

3. **Weather & Natural Disasters**:
   - Seasonal weather patterns for travel dates
   - Hurricane/typhoon season risks
   - Earthquake/volcanic activity in region
   - Flooding or extreme weather forecasts

4. **Health & Safety**:
   - Vaccination requirements
   - Local health advisories
   - Medical facility accessibility
   - Food/water safety concerns

5. **Infrastructure & Transportation**:
   - Airport strikes or disruptions
   - Local transportation reliability
   - Hotel area safety
   - Infrastructure quality

Only create alerts for GENUINE, REALISTIC risks based on the specific destination and travel dates. Do not create generic or hypothetical risks.

Respond with a JSON object containing:
{
  "risk_level": "low|medium|high|critical",
  "alerts": [
    {
      "type": "flight_delay|flight_cancellation|weather|security|health|natural_disaster|infrastructure|other",
      "severity": "low|medium|high|critical",
      "title": "Brief title",
      "description": "Detailed description with specific facts",
      "location": "Affected location",
      "affected_flights": ["flight codes if applicable"],
      "recommended_actions": ["Specific actionable steps"],
      "source": "Source of information"
    }
  ],
  "assessment": "Overall risk assessment summary with specific details about this destination and route"
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
