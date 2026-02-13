import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { city, country, travel_dates } = await req.json();

    if (!city || !country) {
      return errorResponse("City and country are required", 400);
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    console.log(`Generating security briefing for: ${city}, ${country}`);

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
          headers: { "Authorization": `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are a security analyst providing travel risk intelligence. Provide factual, current information." },
              { role: "user", content: `Provide current security and travel risk information for ${city}, ${country}${travel_dates ? ` for travel around ${travel_dates}` : ''}: travel advisory level, recent security incidents, crime situation, political stability, health risks, natural hazards, transportation safety, terrorism threat, emergency contacts.` }
            ],
            search_recency_filter: "month",
          }),
        });

        if (perplexityResponse.ok) {
          const perplexityData = await perplexityResponse.json();
          perplexityIntel = { content: perplexityData.choices?.[0]?.message?.content, citations: perplexityData.citations || [] };
        }
      } catch (e) {
        console.error("Perplexity error:", e);
      }
    }

    const formatSignals = (sigs: any[]) => {
      if (!sigs || sigs.length === 0) return "No recent signals.";
      return sigs.map(s => `- [${s.severity?.toUpperCase() || 'INFO'}] ${s.title} (${new Date(s.created_at).toLocaleDateString()}): ${s.content?.substring(0, 200) || ''}`).join('\n');
    };

    const formatExistingReports = (reports: any[]) => {
      if (!reports || reports.length === 0) return "No existing third-party reports.";
      return reports.map(r => { const data = r.parsed_data; return `- ${r.provider}: ${data?.risk_rating} risk (${r.valid_date})\n  Key risks: ${data?.key_risks?.join(', ') || 'N/A'}`; }).join('\n');
    };

    const prompt = `Generate a comprehensive security briefing for ${city}, ${country}.
${travel_dates ? `Travel dates: ${travel_dates}` : ''}

=== FORTRESS INTELLIGENCE DATA ===
Recent Signals (${signals?.length || 0}):
${formatSignals(signals || [])}

Recent Incidents (${incidents?.length || 0}):
${incidents?.map(i => `- [${i.severity}] ${i.title}: ${i.description?.substring(0, 150)}`).join('\n') || 'None'}

Third-Party Reports:
${formatExistingReports(existingReports || [])}

=== REAL-TIME INTELLIGENCE (Perplexity) ===
${perplexityIntel?.content || 'Real-time intelligence not available.'}
${perplexityIntel?.citations?.length ? `Sources: ${perplexityIntel.citations.slice(0, 5).join(', ')}` : ''}

Create a professional security briefing with location overview, risk rating, key risks, latest developments, security advice, transportation, emergency contacts, and travel advisory.`;

    const tools = [{
      type: "function",
      function: {
        name: "generate_security_briefing",
        description: "Generate a structured security briefing",
        parameters: {
          type: "object",
          properties: {
            location: { type: "object", properties: { city: { type: "string" }, country: { type: "string" } }, required: ["city", "country"] },
            risk_rating: { type: "string", enum: ["INSIGNIFICANT", "LOW", "MEDIUM", "HIGH", "EXTREME"] },
            overview: { type: "string" },
            key_risks: { type: "array", items: { type: "object", properties: { category: { type: "string" }, level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "EXTREME"] }, description: { type: "string" } }, required: ["category", "level", "description"] } },
            latest_developments: { type: "array", items: { type: "object", properties: { date: { type: "string" }, title: { type: "string" }, description: { type: "string" } } } },
            security_advice: { type: "array", items: { type: "object", properties: { category: { type: "string" }, recommendations: { type: "array", items: { type: "string" } } } } },
            transportation: { type: "object", properties: { airport: { type: "string" }, ground_transport: { type: "string" }, recommendations: { type: "array", items: { type: "string" } } } },
            emergency_contacts: { type: "array", items: { type: "object", properties: { name: { type: "string" }, number: { type: "string" } } } },
            travel_advisory: { type: "string" },
            sources: { type: "array", items: { type: "string" } }
          },
          required: ["location", "risk_rating", "overview", "key_risks", "travel_advisory"]
        }
      }
    }];

    const aiResult = await callAiGateway({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are an expert security analyst who produces professional security briefings in the style of International SOS and Control Risks." },
        { role: "user", content: prompt }
      ],
      functionName: 'generate-security-briefing',
      extraBody: { tools, tool_choice: { type: "function", function: { name: "generate_security_briefing" } } },
      dlqOnFailure: true,
      dlqPayload: { city, country, travel_dates },
    });

    if (aiResult.error) {
      throw new Error("Failed to generate security briefing");
    }

    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No briefing generated");
    }

    const briefing = JSON.parse(toolCall.function.arguments);
    
    if (perplexityIntel?.citations) {
      briefing.sources = [...(briefing.sources || []), ...perplexityIntel.citations.slice(0, 5)];
    }

    return successResponse({ success: true, briefing });
  } catch (error) {
    console.error("Error generating security briefing:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});