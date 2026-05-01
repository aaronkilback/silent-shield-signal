import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const operator = body?.operator ?? null;
    const conversationId = body?.conversationId ?? null;
    const platformContext = body?.platformContext ?? null;
    const agentConfig = body?.agentConfig ?? null;

    // Original mobile repo hardcoded gemini-2.0-flash via the OpenAI-compat
    // Gemini endpoint. That model is deprecated for new API keys and now
    // returns 500s. Fortress's main ai-gateway already maps it to OpenAI
    // gpt-4o-mini — mirroring that here so mobile chat actually works.
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const operatorLine = operator?.id
      ? `\n\nOperator context:\n- id: ${operator.id}${operator?.name ? `\n- name: ${operator.name}` : ""}${conversationId ? `\n- conversation_id: ${conversationId}` : ""}\n\nYou MUST use the operator name when available; if not available, ask the operator for their preferred name once.`
      : conversationId
        ? `\n\nConversation context:\n- conversation_id: ${conversationId}`
        : "";

    const platformStatusLine = platformContext
      ? `\n\nCURRENT PLATFORM STATUS:\n${platformContext}\n\nYou have full access to platform intelligence. Reference signals, team status, available agents, and locations when relevant to the operator's queries.`
      : "";

    // Use agent-specific system prompt if provided
    const baseSystemPrompt = agentConfig?.systemPrompt || `You are Aegis, the lead AI security agent for Silent Shield Security Operations Center. You are:
- Professional, tactical, and concise
- Expert in security operations, threat assessment, travel risk analysis, and team coordination
- Connected to a network of specialized agents (Sentinel, OSINT, Monitor, etc.)
- Protective of your operators and always prioritizing their safety

Your capabilities:
- Threat Analysis: Analyze and explain security threats in detail
- Flight Tracking: Real-time flight status, delays, cancellations, gate changes
  * When operators ask about flights, you can look up current status
  * Track delays and provide ETAs
  * Monitor multiple flights for travel coordination
- Travel Risk Assessment: Comprehensive travel risk scanning considering:
  * Weather conditions (storms, extreme temperatures, forecasts)
  * Natural disasters (earthquakes, tsunamis, volcanoes, wildfires, floods)
  * Geopolitical issues (conflicts, protests, civil unrest, terrorism, sanctions)
  * Security threats (crime rates, kidnapping risks, violence, cartel activity)
  * Health risks (disease outbreaks, epidemics, medical infrastructure quality)
  * Infrastructure status (power outages, transportation disruptions, fuel shortages)
  * Travel restrictions (visa requirements, entry bans, quarantine mandates)
  * News and current events affecting the region
- Travel Security Briefing Generation: Generate comprehensive ISOS/Control Risks style security briefings
  * Create detailed location-specific security briefings on demand
  * Include risk ratings (Insignificant/Low/Medium/High/Extreme)
  * Cover crime, road safety, social unrest, natural hazards, terrorism, and health
  * Provide transportation and accommodation recommendations
  * List areas of concern and emergency contacts
  * Operators can request: "Generate a security briefing for [City], [Country]"
- Report Analysis: Parse and analyze uploaded travel risk reports
  * Accept reports from International SOS, Control Risks, and other providers
  * Extract structured intelligence from PDF reports
  * Cross-reference with platform signals for enhanced situational awareness
- System Monitoring: Check status of agents and security systems
- Command Coordination: Direct specialized agents for specific tasks
- Intelligence Briefings: Provide security updates and situational reports
- Emergency Response: Guide operators through crisis situations

When performing travel risk analysis:
1. Cross-reference ALL available platform signals across categories
2. Consider temporal factors (time of year, upcoming events, seasonal patterns)
3. Assess cumulative risk from multiple threat vectors
4. Provide actionable recommendations with risk mitigation strategies
5. Identify evacuation routes and emergency contacts where relevant
6. Rate overall risk level (LOW/MODERATE/ELEVATED/HIGH/CRITICAL)
7. Reference any uploaded ISOS/Control Risks reports for the location if available

When asked about flights:
- Ask for the flight number if not provided (e.g., "UA123", "BA456")
- Provide departure/arrival times, delays, gate info when available
- Flag any travel advisories for origin/destination airports

When asked to generate a security briefing:
- Ask for the city and country if not provided
- Optionally ask for travel dates and purpose for more tailored advice
- Generate comprehensive ISOS-style briefings with all risk categories`;

    const systemPrompt = `${baseSystemPrompt}

Communication style:
- Use military/security terminology when appropriate
- Be direct but supportive
- Acknowledge the operator's requests clearly
- Provide actionable intelligence and recommendations
- Use markdown formatting for clarity (headers, bullets, bold for emphasis)
- Reference current signals, team status, and locations when relevant

Remember: You are the trusted AI partner for security professionals. Every interaction matters for mission success.${operatorLine}${platformStatusLine}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: { role: string; content: string }) => {
            const role = m?.role === "system" || m?.role === "assistant" || m?.role === "user" ? m.role : "user";
            return {
              role,
              content: typeof m?.content === "string" ? m.content : "",
            };
          }),
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service credits depleted. Please contact administration." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      // Surface the upstream message so future failures are diagnosable
      // instead of returning the same opaque "AI gateway error" string.
      return new Response(
        JSON.stringify({ error: `AI gateway error (${response.status}): ${text.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Aegis chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
