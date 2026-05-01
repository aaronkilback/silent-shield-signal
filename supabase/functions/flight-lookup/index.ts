import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: "Missing query parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      throw new Error("PERPLEXITY_API_KEY is not configured");
    }

    const searchPrompt = `Current real-time flight status for ${query}. Include:
- Flight number and airline
- Departure airport, scheduled time, actual/estimated time, gate, terminal
- Arrival airport, scheduled time, actual/estimated time, gate, terminal  
- Current flight status (on time, delayed, cancelled, in-flight, landed)
- If delayed: delay duration in minutes and reason if known
- Aircraft type if available
Provide only factual current information, not historical data.

IMPORTANT: At the end of your response, include a JSON block in this exact format:
\`\`\`json
{"status":"scheduled|delayed|cancelled|departed|arrived","gate":"A12","terminal":"2","delay_minutes":0,"delay_reason":""}
\`\`\`
Use only the status values listed. Set delay_minutes to 0 if on time. Leave gate/terminal empty string if unknown.`;

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
            content: "You are a flight information assistant. Provide accurate, real-time flight status information. Be concise and structured. Always end with the requested JSON block. If you cannot find current information for a flight, still provide the JSON block with status 'scheduled' and delay_minutes 0." 
          },
          { role: "user", content: searchPrompt }
        ],
        search_recency_filter: "day",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Perplexity API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to fetch flight information" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "No flight information found.";
    const citations = data.citations || [];

    // Parse the structured JSON from the response
    let parsed = null;
    const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
        // Validate status value
        const validStatuses = ["scheduled", "delayed", "cancelled", "departed", "arrived"];
        if (parsed.status && !validStatuses.includes(parsed.status)) {
          parsed.status = "scheduled";
        }
        // Ensure delay_minutes is a number
        parsed.delay_minutes = parseInt(parsed.delay_minutes) || 0;
        // Clean empty strings
        if (!parsed.gate) parsed.gate = null;
        if (!parsed.terminal) parsed.terminal = null;
        if (!parsed.delay_reason) parsed.delay_reason = null;
      } catch {
        console.error("Failed to parse flight JSON block");
      }
    }

    // Remove the JSON block from the display text
    const summary = content.replace(/```json[\s\S]*?```/, "").trim();

    return new Response(
      JSON.stringify({ 
        result: summary,
        parsed,
        citations,
        query,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Flight lookup error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
