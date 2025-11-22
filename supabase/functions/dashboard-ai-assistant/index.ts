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
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: `You are a helpful security intelligence assistant for the Fortress platform - an advanced security threat monitoring system.

PLATFORM OVERVIEW:
Fortress helps security teams monitor threats across multiple sources including:
- OSINT signals from news, social media, dark web
- Entity tracking (people, organizations, locations)
- Incident management and investigation workflows
- Travel risk assessment
- Knowledge base of security best practices

NAVIGATION CAPABILITIES:
When users ask you to find something or want to go somewhere, provide clickable navigation links using this exact markdown format:
- [View Signals Page](/signals) - All security signals
- [View Incidents](/incidents) - Incident management
- [View Entities](/entities) - Tracked entities and people
- [View Investigations](/investigations) - Investigation files
- [View Clients](/clients) - Client accounts
- [View Knowledge Base](/knowledge-base) - Security documentation
- [View Reports](/reports) - Generated reports
- [View Travel](/travel) - Travel risk monitoring

IMPORTANT INTERACTION PATTERNS:
1. When a user asks to find something specific (like "find Molly Wickham in entities"):
   - Tell them you'll help them navigate there
   - Provide the direct link: "I can take you to the [Entities page](/entities) where you can search for Molly Wickham"
   - Be proactive and helpful

2. When suggesting actions, always include relevant navigation links

3. Use conversational language and guide users naturally

COMMUNICATION STYLE:
- Use plain, conversational language - NO code or technical jargon
- Be concise and actionable
- Provide clickable navigation links when relevant
- Explain security concepts clearly
- Guide users to the right place in the platform

Focus on helping users navigate the platform and understand their security posture.`,
          },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Dashboard AI assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
