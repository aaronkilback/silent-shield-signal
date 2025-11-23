import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tool definitions for querying the database
const tools = [
  {
    type: "function",
    function: {
      name: "get_recent_signals",
      description: "Get recent security signals from the system. Use this when users ask about signals, threats, or recent activity.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of signals to return (default 10)",
          },
          client_id: {
            type: "string",
            description: "Filter by client - can be either a UUID or client name (will search by name)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_entities",
      description: "Search for entities (people, organizations, locations). Use this when users ask to find a specific person or entity.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for entity name",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_incidents",
      description: "Get currently active security incidents. Use this when users ask about ongoing incidents or incident status.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of incidents to return (default 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_investigations",
      description: "Search investigation files. Use this when users ask about investigations or case files.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for investigation file number or content",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clients",
      description: "Search for client accounts. Use this when users ask about clients or organizations.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for client name",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monitoring_status",
      description: "Check monitoring scan status and history. Use this when users ask if monitors are working, about scan failures, or system health.",
      parameters: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "Number of hours to look back (default 24)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_health",
      description: "Get overall system health metrics including automation performance, error rates, and throughput. Use when troubleshooting system issues.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to analyze (default 7)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_issues",
      description: "Analyze recent errors and failed scans to identify problems. Use when troubleshooting or when users report issues.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent errors to analyze (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_signals_by_entity",
      description: "Search for signals related to a specific entity or person. Use this when users ask about threats, hazards, or signals related to a person or organization.",
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Name of the entity or person to search for",
          },
          limit: {
            type: "number",
            description: "Number of signals to return (default 20)",
          },
        },
        required: ["entity_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_osint_scan",
      description: "Trigger an OSINT (Open Source Intelligence) scan for a specific entity. This searches the web for information about the entity and creates intelligence content. Use this when users want to gather intelligence or perform research on a person or organization.",
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Name of the entity to scan",
          },
        },
        required: ["entity_name"],
      },
    },
  },
];

// Execute tools by querying Supabase
async function executeTool(toolName: string, args: any, supabaseClient: any) {
  console.log(`Executing tool: ${toolName}`, args);

  switch (toolName) {
    case "get_recent_signals": {
      let query = supabaseClient
        .from("signals")
        .select("id, title, description, severity, received_at, status, client_id, clients(name)")
        .order("received_at", { ascending: false })
        .limit(args.limit || 10);

      if (args.client_id) {
        // Check if it's a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        
        if (uuidRegex.test(args.client_id)) {
          // It's a UUID, use directly
          query = query.eq("client_id", args.client_id);
        } else {
          // It's likely a client name, look it up first
          const { data: client, error: clientError } = await supabaseClient
            .from("clients")
            .select("id")
            .ilike("name", `%${args.client_id}%`)
            .limit(1)
            .single();
          
          if (clientError || !client) {
            return { 
              message: `No client found matching "${args.client_id}"`,
              signals: [] 
            };
          }
          
          query = query.eq("client_id", client.id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    case "search_entities": {
      const { data, error } = await supabaseClient
        .from("entities")
        .select("id, name, type, description, risk_level, threat_score, current_location")
        .ilike("name", `%${args.query}%`)
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "get_active_incidents": {
      const { data, error } = await supabaseClient
        .from("incidents")
        .select("id, title, status, priority, severity_level, opened_at, client_id, clients(name)")
        .in("status", ["open", "investigating", "contained"])
        .order("opened_at", { ascending: false })
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "search_investigations": {
      const { data, error } = await supabaseClient
        .from("investigations")
        .select("id, file_number, synopsis, file_status, created_at, client_id, clients(name)")
        .or(`file_number.ilike.%${args.query}%,synopsis.ilike.%${args.query}%`)
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "search_clients": {
      const { data, error } = await supabaseClient
        .from("clients")
        .select("id, name, industry, status, locations")
        .ilike("name", `%${args.query}%`)
        .limit(10);

      if (error) throw error;
      return data;
    }

    case "get_monitoring_status": {
      const hours = args.hours || 24;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabaseClient
        .from("monitoring_history")
        .select("*")
        .gte("scan_started_at", cutoff)
        .order("scan_started_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Analyze the results
      const bySource = data.reduce((acc: any, scan: any) => {
        if (!acc[scan.source_name]) {
          acc[scan.source_name] = { total: 0, completed: 0, failed: 0, running: 0 };
        }
        acc[scan.source_name].total++;
        if (scan.status === "completed") acc[scan.source_name].completed++;
        if (scan.status === "failed") acc[scan.source_name].failed++;
        if (scan.status === "running") acc[scan.source_name].running++;
        return acc;
      }, {});

      return {
        summary: bySource,
        total_scans: data.length,
        recent_scans: data.slice(0, 10),
      };
    }

    case "get_system_health": {
      const days = args.days || 7;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: metrics, error: metricsError } = await supabaseClient
        .from("automation_metrics")
        .select("*")
        .gte("metric_date", cutoff)
        .order("metric_date", { ascending: false });

      if (metricsError) throw metricsError;

      const { data: activeIncidents, error: incidentsError } = await supabaseClient
        .from("incidents")
        .select("id, status, priority")
        .in("status", ["open", "investigating"])
        .limit(100);

      if (incidentsError) throw incidentsError;

      const { data: recentSignals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, created_at, status")
        .gte("created_at", cutoff)
        .limit(1000);

      if (signalsError) throw signalsError;

      // Calculate totals
      const totals = metrics.reduce((acc: any, m: any) => {
        acc.signals_processed += m.signals_processed || 0;
        acc.incidents_created += m.incidents_created || 0;
        acc.osint_scans += m.osint_scans_completed || 0;
        acc.alerts_sent += m.alerts_sent || 0;
        return acc;
      }, { signals_processed: 0, incidents_created: 0, osint_scans: 0, alerts_sent: 0 });

      return {
        metrics: totals,
        active_incidents_count: activeIncidents.length,
        signals_last_7_days: recentSignals.length,
        average_scans_per_day: Math.round(totals.osint_scans / days),
        latest_metrics: metrics[0],
      };
    }

    case "diagnose_issues": {
      const limit = args.limit || 20;

      // Get failed scans
      const { data: failedScans, error: scanError } = await supabaseClient
        .from("monitoring_history")
        .select("*")
        .eq("status", "failed")
        .order("scan_started_at", { ascending: false })
        .limit(limit);

      if (scanError) throw scanError;

      // Get sources with errors
      const { data: errorSources, error: sourceError } = await supabaseClient
        .from("sources")
        .select("name, status, error_message, last_ingested_at")
        .not("error_message", "is", null)
        .limit(20);

      if (sourceError) throw sourceError;

      // Analyze patterns
      const errorPatterns: { [key: string]: number } = {};
      failedScans.forEach((scan: any) => {
        const source = scan.source_name;
        errorPatterns[source] = (errorPatterns[source] || 0) + 1;
      });

      return {
        failed_scans: failedScans,
        error_sources: errorSources,
        error_patterns: errorPatterns,
        total_errors: failedScans.length,
        recommendation: failedScans.length > 10
          ? "High error rate detected. Check rate limits and API configurations."
          : "System appears healthy with minimal errors.",
      };
    }

    case "search_signals_by_entity": {
      // First, find the entity
      const { data: entities, error: entityError } = await supabaseClient
        .from("entities")
        .select("id, name, type, description")
        .ilike("name", `%${args.entity_name}%`)
        .limit(5);

      if (entityError) throw entityError;
      if (!entities || entities.length === 0) {
        return { message: `No entity found matching "${args.entity_name}"`, signals: [] };
      }

      // Get entity IDs
      const entityIds = entities.map((e: any) => e.id);

      // Find signals that mention these entities
      const { data: mentions, error: mentionsError } = await supabaseClient
        .from("entity_mentions")
        .select("signal_id, entity_id, confidence, context")
        .in("entity_id", entityIds)
        .order("detected_at", { ascending: false })
        .limit(args.limit || 20);

      if (mentionsError) throw mentionsError;

      if (!mentions || mentions.length === 0) {
        return { 
          entities: entities,
          message: `Found entity "${entities[0].name}" but no signals mention this entity yet.`,
          signals: [] 
        };
      }

      // Get the actual signals
      const signalIds = [...new Set(mentions.map((m: any) => m.signal_id))];
      const { data: signals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, title, description, severity, received_at, status, category, client_id, clients(name)")
        .in("id", signalIds)
        .order("received_at", { ascending: false });

      if (signalsError) throw signalsError;

      return {
        entities: entities,
        entity_mentions_count: mentions.length,
        signals: signals || [],
      };
    }

    case "trigger_osint_scan": {
      // Find the entity first
      const { data: entity, error: findError } = await supabaseClient
        .from("entities")
        .select("id, name, type")
        .ilike("name", `%${args.entity_name}%`)
        .limit(1)
        .single();

      if (findError || !entity) {
        return { 
          success: false, 
          message: `No entity found matching "${args.entity_name}". Please create the entity first using [Create Entity](/entities).`,
          note: "OSINT scans require an existing entity in the system."
        };
      }

      // Trigger the OSINT scan
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      const scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/osint-web-search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entity_id: entity.id })
      });

      if (!scanResponse.ok) {
        const errorText = await scanResponse.text();
        console.error('OSINT scan failed:', errorText);
        
        // Check if it's a configuration error
        if (errorText.includes('Google Search API not configured')) {
          return {
            success: false,
            message: "OSINT scanning requires Google Search API configuration. Contact your administrator to configure GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.",
            entity: entity.name
          };
        }
        
        return { 
          success: false, 
          message: `OSINT scan failed for ${entity.name}. Error: ${errorText}`,
          entity: entity.name
        };
      }

      const result = await scanResponse.json();
      
      return {
        success: true,
        message: `OSINT scan completed for ${entity.name}. Created ${result.content_created} intelligence items and ${result.signals_created} signals.`,
        entity: entity.name,
        content_created: result.content_created,
        signals_created: result.signals_created,
        next_steps: "View the results in [Entity Content](/entities) or check [Signals](/signals) for any security concerns identified."
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // First AI call with tools
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
            content: `You are a helpful security intelligence assistant for the Fortress platform.

You have access to tools to query the database for:
- Recent security signals
- Signals related to specific entities or people
- Entity information (people, organizations, locations)
- Active incidents
- Investigation files
- Client accounts
- System monitoring status and health
- Error diagnostics and troubleshooting
- OSINT (Open Source Intelligence) scanning capabilities

OSINT SCANNING:
When users ask to gather intelligence, perform research, or look for information about a person or organization:
1. First check if the entity exists in the system using search_entities
2. If it exists, use trigger_osint_scan to perform a comprehensive web search
3. The OSINT scan will search multiple sources including social media, news, and public records
4. Results are automatically processed and added as entity content and signals
5. If OSINT scanning is not configured, inform the user it requires Google Search API setup

TROUBLESHOOTING CAPABILITIES:
When users ask about system issues, monitoring problems, or "why isn't X working":
1. Use get_monitoring_status to check if scans are running
2. Use get_system_health to view overall system performance
3. Use diagnose_issues to identify specific errors and patterns
4. Provide clear explanations of what's working and what's not
5. Offer specific recommendations to fix issues

Common issues to look for:
- Rate limiting (429 errors from social media monitors)
- Failed scans or sources with errors
- Low scan frequency or missing data
- Stale data (no recent scans)

When users ask about specific data:
1. Use the appropriate tool to fetch the information
2. Summarize the results in a clear, conversational way
3. Provide navigation links when relevant using markdown format: [Link Text](/path)

Available pages:
- [View Signals](/signals) - All security signals
- [View Incidents](/incidents) - Incident management
- [View Entities](/entities) - Tracked entities and people
- [View Investigations](/investigations) - Investigation files
- [View Clients](/clients) - Client accounts
- [View Monitoring Sources](/monitoring-sources) - Configure monitoring

Be conversational and helpful. When showing data, format it clearly with bullet points or structured text.
When troubleshooting, be specific about what you found and how to fix it.`,
          },
          ...messages,
        ],
        tools,
        tool_choice: "auto",
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

    const firstResult = await response.json();
    const firstMessage = firstResult.choices[0].message;

    // Check if AI wants to use tools
    if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
      console.log("AI requested tool calls:", firstMessage.tool_calls);

      // Execute all tool calls
      const toolResults = await Promise.all(
        firstMessage.tool_calls.map(async (toolCall: any) => {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, supabaseClient);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify(result),
            };
          } catch (error) {
            console.error(`Tool execution error for ${toolCall.function.name}:`, error);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            };
          }
        })
      );

      // Make second AI call with tool results - now with streaming
      const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
              content: `You are a helpful security intelligence assistant. Summarize the tool results in a clear, conversational way. Use markdown links for navigation: [Link Text](/path). Be concise and helpful.`,
            },
            ...messages,
            firstMessage,
            ...toolResults,
          ],
          stream: true,
        }),
      });

      if (!finalResponse.ok) {
        throw new Error("Failed to get final response from AI");
      }

      return new Response(finalResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // No tools needed, stream the response directly
    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: `You are a helpful security intelligence assistant with troubleshooting capabilities. Use plain, conversational language. Provide navigation links when relevant using markdown format: [Link Text](/path). When diagnosing issues, be specific and actionable.`,
          },
          ...messages,
        ],
        stream: true,
      }),
    });

    return new Response(streamResponse.body, {
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
