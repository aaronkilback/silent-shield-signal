import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { highPrioritySignals, criticalIncidents, openIncidents, recentShot } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const situationContext = [
      `Current posture: ${criticalIncidents} critical incidents, ${openIncidents} open incidents, ${highPrioritySignals} high-priority signals.`,
      recentShot ? `Yesterday's incident: ${recentShot}` : "No incidents yesterday.",
    ].join(" ");

    const systemPrompt = `You are a Silent Shield doctrine advisor for a corporate security operations center. You provide daily operational guidance grounded in real security frameworks (ASIS, NIST, ISO 31000, CISA, MITRE ATT&CK, intelligence community tradecraft).

Your output must be JSON with exactly two fields:
- "doctrine_anchor": One sentence (max 25 words). A specific, tactical behavioral instruction for today. Not a quote. Not motivational. A concrete operational behavior derived from established security doctrine or intelligence tradecraft. Reference the framework implicitly through the behavior, not by name. Must be different every day. Examples of the caliber expected:
  - "Validate your top three detection rules against last week's missed signals before reviewing new intake."
  - "Brief one non-security stakeholder on current exposure today to test your own understanding."
  - "Trace one alert backwards to its earliest precursor to verify your detection chain is intact."

- "exposure_question": One question (max 30 words). Consequence-focused, sharp, designed to surface blind spots. Must relate to the current operational situation. Not generic. Examples:
  - "If your primary OSINT feed went dark today, which entity would lose coverage first?"
  - "What is the oldest unresolved indicator in your queue, and what has it become while waiting?"

Current situation: ${situationContext}

Respond ONLY with valid JSON. No markdown. No explanation.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate today's doctrine anchor and exposure question." },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response, handling potential markdown wrapping
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    
    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify({
      doctrine_anchor: parsed.doctrine_anchor,
      exposure_question: parsed.exposure_question,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-posture-content error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
