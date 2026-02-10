import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

    // Fetch doctrine library content
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: doctrineEntries } = await supabase
      .from("doctrine_library")
      .select("title, content_text, content_type, tags")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(30);

    const hasDoctrineContent = doctrineEntries && doctrineEntries.length > 0;

    // Build doctrine context from library
    let doctrineContext = "";
    if (hasDoctrineContent) {
      const principles = doctrineEntries
        .filter((d: any) => d.content_text)
        .map((d: any) => `- [${d.content_type}] ${d.title}: ${d.content_text}`)
        .join("\n");
      doctrineContext = `\n\nSILENT SHIELD DOCTRINE LIBRARY (PRIMARY SOURCE — draw from these first):\n${principles}`;
    }

    const situationContext = [
      `Current posture: ${criticalIncidents} critical incidents, ${openIncidents} open incidents, ${highPrioritySignals} high-priority signals.`,
      recentShot ? `Yesterday's incident: ${recentShot}` : "No incidents yesterday.",
    ].join(" ");

    const systemPrompt = `You are the Silent Shield doctrine advisor for a corporate security operations center.

YOUR PRIMARY TASK: Generate one fresh doctrine anchor and one exposure question for today's operational posture.

CONTENT SOURCING RULES (in priority order):
1. FIRST: Use the Silent Shield Doctrine Library content below if available. Derive new tactical applications, variations, and combinations from these proprietary principles. Never repeat them verbatim — translate them into today's specific operational behavior.
2. FALLBACK: If the doctrine library is empty or insufficient, draw from established open-source security frameworks (ASIS, NIST CSF, ISO 31000, CISA, MITRE ATT&CK, intelligence community tradecraft) to generate content in the Silent Shield operational style.
${doctrineContext}

OUTPUT FORMAT — JSON with exactly two fields:
- "doctrine_anchor": One sentence (max 25 words). A specific, tactical behavioral instruction for today. Not a quote. Not motivational. A concrete operational behavior. Must be actionable by an analyst or operator right now.
- "exposure_question": One question (max 30 words). Consequence-focused. Designed to surface a blind spot related to today's operational situation. Not generic.

Current situation: ${situationContext}

CRITICAL: Content must be fresh and unique every day. Never produce the same output twice. Vary structure, focus area, and tactical domain.

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
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    
    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify({
      doctrine_anchor: parsed.doctrine_anchor,
      exposure_question: parsed.exposure_question,
      source: hasDoctrineContent ? "doctrine_library" : "open_source",
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
