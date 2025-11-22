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

YOU HAVE ACCESS TO SEARCH TOOLS - USE THEM PROACTIVELY:
When users ask about specific information, ALWAYS search for it using the available tools and provide direct links to relevant pages.

AVAILABLE TOOLS:
- get_recent_signals: Get latest security signals
- get_active_incidents: Get active incidents
- search_entities: Search for entities by name
- search_signals: Search signals by keyword
- search_investigations: Search investigations by file number or content
- search_knowledge_base: Search knowledge base articles
- search_clients: Search client records
- get_entity_details: Get detailed entity information
- get_monitoring_stats: Get monitoring performance metrics
- trigger_manual_scan: Trigger a manual source scan
- get_client_risk_summary: Get client risk summaries

PROVIDING LINKS:
When you find relevant information, ALWAYS provide clickable links using this format:
- Signals: [Signal Title](/signals) - link to signals page, mention the specific signal
- Incidents: [Incident Title](/incidents) - link to incidents page, mention the specific incident  
- Entities: [Entity Name](/entities) - link to entities page, mention the specific entity
- Investigations: [File Number](/investigations) - link to investigations page, mention the specific investigation
- Clients: [Client Name](/clients) - link to clients page, mention the specific client
- Knowledge Base: [Article Title](/knowledge-base) - link to knowledge base

COMMUNICATION STYLE:
- Use plain, conversational language - NO code, NO technical syntax
- Always search for and link to relevant platform information when users ask questions
- Be proactive - if a user asks about threats, search for recent signals and link to them
- Explain concepts clearly without programming terminology
- Be concise, actionable, and security-focused`,
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
              name: "search_signals",
              description: "Search for signals by keyword in title or description",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search keyword" },
                  limit: { type: "number", description: "Number of results (default 10)" }
                },
                required: ["query"]
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
              name: "search_investigations",
              description: "Search investigations by file number or synopsis",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search keyword" },
                  limit: { type: "number", description: "Number of results (default 10)" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "search_knowledge_base",
              description: "Search knowledge base articles",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search keyword" },
                  limit: { type: "number", description: "Number of results (default 10)" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "search_clients",
              description: "Search client records by name or industry",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search keyword" },
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
