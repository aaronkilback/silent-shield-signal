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
        model: "google/gemini-3-pro-preview",
        messages: [
          {
            role: "system",
            content: `You are an intelligent security intelligence assistant for the Fortress platform - an advanced security intelligence and threat monitoring system.

PLATFORM CONTEXT:
Fortress is a comprehensive security intelligence platform that provides:
- Real-time threat monitoring and signal detection from multiple OSINT sources
- Client-specific security monitoring with customizable keywords and risk profiles
- Entity tracking (people, organizations, locations, events, threats)
- Automated incident creation and escalation
- Travel risk assessment and itinerary monitoring
- Investigation management and documentation
- Learning systems that adapt based on feedback

YOU HAVE ACCESS TO REAL-TIME DATA via tools. Use them proactively when users ask questions about:
- Current threats, signals, or incidents
- Entity information or searches
- Monitoring statistics and performance
- Client risk assessments

AVAILABLE TOOLS:
- get_recent_signals: Get the latest security signals (limit optional)
- get_active_incidents: Get currently active incidents (limit optional)
- search_entities: Search for entities by name or alias (query required)
- get_entity_details: Get detailed info about a specific entity (entityId required)
- get_monitoring_stats: Get recent monitoring performance metrics
- trigger_manual_scan: Trigger a manual scan of a source (source optional: news, social, darkweb, etc.)
- get_client_risk_summary: Get risk summary for all clients (limit optional)

Be concise, actionable, and security-focused. When users ask questions about current state, USE THE TOOLS to get real data. Don't just give general advice - show them actual signals, incidents, or entity information from their system.`,
          },
          ...messages,
        ],
        stream: true,
        tools: [
          {
            type: "function",
            function: {
              name: "get_recent_signals",
              description: "Retrieve the most recent security signals from the system",
              parameters: {
                type: "object",
                properties: {
                  limit: { type: "number", description: "Number of signals to return (default 10)" }
                }
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_active_incidents",
              description: "Get currently active security incidents",
              parameters: {
                type: "object",
                properties: {
                  limit: { type: "number", description: "Number of incidents to return (default 10)" }
                }
              }
            }
          },
          {
            type: "function",
            function: {
              name: "search_entities",
              description: "Search for entities by name or alias",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                  limit: { type: "number", description: "Number of results (default 10)" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_entity_details",
              description: "Get detailed information about a specific entity",
              parameters: {
                type: "object",
                properties: {
                  entityId: { type: "string", description: "Entity ID" }
                },
                required: ["entityId"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_monitoring_stats",
              description: "Get recent monitoring performance statistics",
              parameters: { type: "object", properties: {} }
            }
          },
          {
            type: "function",
            function: {
              name: "trigger_manual_scan",
              description: "Trigger a manual scan of a monitoring source",
              parameters: {
                type: "object",
                properties: {
                  source: { 
                    type: "string", 
                    description: "Source to scan (news, social, darkweb, linkedin, instagram, etc.)",
                    enum: ["news", "social", "darkweb", "linkedin", "instagram", "facebook", "pastebin"]
                  }
                }
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_client_risk_summary",
              description: "Get risk summary for all monitored clients",
              parameters: {
                type: "object",
                properties: {
                  limit: { type: "number", description: "Number of clients (default 5)" }
                }
              }
            }
          }
        ],
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Dashboard AI assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
