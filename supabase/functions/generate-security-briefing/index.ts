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
    const { city, country, travel_dates } = await req.json();

    if (!city || !country) {
      throw new Error("City and country are required");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log(`Generating security briefing for: ${city}, ${country}`);

    // Query Fortress signals for this location
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const locationTerms = [city, country, `${city}, ${country}`];

    const { data: signals } = await supabaseClient
      .from("signals")
      .select("title, content, category, severity, source_type, created_at, location")
      .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: incidents } = await supabaseClient
      .from("incidents")
      .select("title, description, severity, created_at, location")
      .or(locationTerms.map(term => `location.ilike.%${term}%`).join(","))
      .gte("created_at", thirtyDaysAgo.toISOString())
      .limit(20);

    const { data: existingReports } = await supabaseClient
      .from("security_reports")
      .select("parsed_data, provider, valid_date")
      .or(`location_city.ilike.%${city}%,location_country.ilike.%${country}%`)
      .order("created_at", { ascending: false })
      .limit(5);

    // Get real-time intelligence from Perplexity if available
    let perplexityIntel = null;
    if (PERPLEXITY_API_KEY) {
      try {
        const perplexityResponse = await fetch("https://api.perplexity.ai/chat/completions", {
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
                content: "You are a security analyst providing travel risk intelligence. Provide factual, current information."
              },
              {
                role: "user",
                content: `Provide current security and travel risk information for ${city}, ${country}${travel_dates ? ` for travel around ${travel_dates}` : ''}:

1. Current travel advisory level
2. Recent security incidents (last 30 days)
3. Crime situation and safety concerns
4. Political stability and civil unrest
5. Health and disease risks
6. Natural hazard risks
7. Transportation safety
8. Terrorism threat level
9. Emergency contact numbers (police, ambulance, embassy)

Focus on actionable intelligence for business travelers.`
              }
            ],
            search_recency_filter: "month",
          }),
        });

        if (perplexityResponse.ok) {
          const perplexityData = await perplexityResponse.json();
          perplexityIntel = {
            content: perplexityData.choices?.[0]?.message?.content,
            citations: perplexityData.citations || []
          };
        }
      } catch (e) {
        console.error("Perplexity error:", e);
      }
    }

    // Format Fortress data
    const formatSignals = (sigs: any[]) => {
      if (!sigs || sigs.length === 0) return "No recent signals.";
      return sigs.map(s => 
        `- [${s.severity?.toUpperCase() || 'INFO'}] ${s.title} (${new Date(s.created_at).toLocaleDateString()}): ${s.content?.substring(0, 200) || ''}`
      ).join('\n');
    };

    const formatExistingReports = (reports: any[]) => {
      if (!reports || reports.length === 0) return "No existing third-party reports.";
      return reports.map(r => {
        const data = r.parsed_data;
        return `- ${r.provider}: ${data?.risk_rating} risk (${r.valid_date})\n  Key risks: ${data?.key_risks?.join(', ') || 'N/A'}`;
      }).join('\n');
    };

    // Generate comprehensive briefing
    const prompt = `Generate a comprehensive security briefing for ${city}, ${country} in the style of International SOS or Control Risks.
${travel_dates ? `Travel dates: ${travel_dates}` : ''}

=== FORTRESS INTELLIGENCE DATA ===

Recent Signals (${signals?.length || 0}):
${formatSignals(signals || [])}

Recent Incidents (${incidents?.length || 0}):
${incidents?.map(i => `- [${i.severity}] ${i.title}: ${i.description?.substring(0, 150)}`).join('\n') || 'None'}

Third-Party Reports on File:
${formatExistingReports(existingReports || [])}

=== REAL-TIME INTELLIGENCE (Perplexity) ===
${perplexityIntel?.content || 'Real-time intelligence not available.'}

${perplexityIntel?.citations?.length ? `Sources: ${perplexityIntel.citations.slice(0, 5).join(', ')}` : ''}

=== BRIEFING REQUIREMENTS ===

Create a professional security briefing with:

1. LOCATION OVERVIEW - Brief description of the location and its security context
2. RISK RATING - Overall risk level (INSIGNIFICANT/LOW/MEDIUM/HIGH/EXTREME)
3. KEY RISKS - Each major risk category with level and description
4. LATEST DEVELOPMENTS - Recent security-relevant events
5. SECURITY ADVICE - Category-specific recommendations
6. TRANSPORTATION - Airport info, ground transport, safety tips
7. EMERGENCY CONTACTS - Local emergency numbers
8. TRAVEL ADVISORY - Summary recommendation for travelers`;

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
            content: "You are an expert security analyst who produces professional security briefings in the style of International SOS and Control Risks. Your briefings are accurate, actionable, and based on verified intelligence."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_security_briefing",
              description: "Generate a structured security briefing",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "object",
                    properties: {
                      city: { type: "string" },
                      country: { type: "string" }
                    },
                    required: ["city", "country"]
                  },
                  risk_rating: { 
                    type: "string",
                    enum: ["INSIGNIFICANT", "LOW", "MEDIUM", "HIGH", "EXTREME"]
                  },
                  overview: { type: "string" },
                  key_risks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string" },
                        level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "EXTREME"] },
                        description: { type: "string" }
                      },
                      required: ["category", "level", "description"]
                    }
                  },
                  latest_developments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string" },
                        title: { type: "string" },
                        description: { type: "string" }
                      }
                    }
                  },
                  security_advice: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string" },
                        recommendations: {
                          type: "array",
                          items: { type: "string" }
                        }
                      }
                    }
                  },
                  transportation: {
                    type: "object",
                    properties: {
                      airport: { type: "string" },
                      ground_transport: { type: "string" },
                      recommendations: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  },
                  emergency_contacts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        number: { type: "string" }
                      }
                    }
                  },
                  travel_advisory: { type: "string" },
                  sources: {
                    type: "array",
                    items: { type: "string" }
                  }
                },
                required: ["location", "risk_rating", "overview", "key_risks", "travel_advisory"]
              }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: { name: "generate_security_briefing" }
        }
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("Failed to generate security briefing");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No briefing generated");
    }

    const briefing = JSON.parse(toolCall.function.arguments);
    
    // Add Perplexity sources if available
    if (perplexityIntel?.citations) {
      briefing.sources = [...(briefing.sources || []), ...perplexityIntel.citations.slice(0, 5)];
    }

    console.log("Generated briefing for:", briefing.location);

    return new Response(
      JSON.stringify({
        success: true,
        briefing,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating security briefing:", error);
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
