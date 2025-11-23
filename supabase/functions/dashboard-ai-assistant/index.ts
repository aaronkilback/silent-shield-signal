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
  {
    type: "function",
    function: {
      name: "create_entity",
      description: "Create a new entity (person, organization, location, etc.) in the system. Use this when users want to add a new entity to track.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the entity",
          },
          type: {
            type: "string",
            description: "Type of entity: person, organization, location, vehicle, or event",
            enum: ["person", "organization", "location", "vehicle", "event"],
          },
          description: {
            type: "string",
            description: "Description of the entity",
          },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Alternative names or aliases",
          },
          risk_level: {
            type: "string",
            description: "Risk level: low, medium, high, or critical",
            enum: ["low", "medium", "high", "critical"],
          },
        },
        required: ["name", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_entity",
      description: "Update an existing entity's information. Use this when users want to modify entity details.",
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "UUID of the entity to update",
          },
          updates: {
            type: "object",
            description: "Fields to update (name, description, risk_level, etc.)",
          },
        },
        required: ["entity_id", "updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_incident",
      description: "Create a new security incident. Use this when users report a security event that needs tracking.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the incident",
          },
          summary: {
            type: "string",
            description: "Summary of the incident",
          },
          priority: {
            type: "string",
            description: "Priority level: p1, p2, p3, or p4",
            enum: ["p1", "p2", "p3", "p4"],
          },
          severity_level: {
            type: "string",
            description: "Severity: P1, P2, P3, or P4",
          },
          client_id: {
            type: "string",
            description: "UUID of the associated client (optional)",
          },
        },
        required: ["title", "priority"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_incident",
      description: "Update an incident's status or details. Use this when users want to acknowledge, contain, or resolve incidents.",
      parameters: {
        type: "object",
        properties: {
          incident_id: {
            type: "string",
            description: "UUID of the incident to update",
          },
          status: {
            type: "string",
            description: "New status: open, acknowledged, contained, or resolved",
            enum: ["open", "acknowledged", "contained", "resolved"],
          },
          summary: {
            type: "string",
            description: "Updated summary (optional)",
          },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_investigation",
      description: "Create a new investigation file. Use this when users want to start a formal investigation.",
      parameters: {
        type: "object",
        properties: {
          file_number: {
            type: "string",
            description: "Investigation file number",
          },
          synopsis: {
            type: "string",
            description: "Brief synopsis of the investigation",
          },
          client_id: {
            type: "string",
            description: "UUID of the associated client (optional)",
          },
          incident_id: {
            type: "string",
            description: "UUID of the associated incident (optional)",
          },
        },
        required: ["file_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_signal_status",
      description: "Mark a signal as reviewed or false positive. Use this when users want to dismiss or acknowledge signals.",
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "UUID of the signal to update",
          },
          is_reviewed: {
            type: "boolean",
            description: "Mark as reviewed",
          },
          is_false_positive: {
            type: "boolean",
            description: "Mark as false positive",
          },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_entity_relationship",
      description: "Create a relationship between two entities. Use this when users want to document connections between people or organizations.",
      parameters: {
        type: "object",
        properties: {
          entity_a_name: {
            type: "string",
            description: "Name of the first entity",
          },
          entity_b_name: {
            type: "string",
            description: "Name of the second entity",
          },
          relationship_type: {
            type: "string",
            description: "Type of relationship (e.g., 'works_for', 'associated_with', 'family')",
          },
          description: {
            type: "string",
            description: "Description of the relationship",
          },
        },
        required: ["entity_a_name", "entity_b_name", "relationship_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_code_issue",
      description: "ADMIN ONLY: Diagnose issues in React components or TypeScript code. Use this when admin asks about bugs, errors, or performance problems in the application code.",
      parameters: {
        type: "object",
        properties: {
          component_name: {
            type: "string",
            description: "Name or path of the component/file to analyze",
          },
          issue_description: {
            type: "string",
            description: "Description of the issue or error",
          },
          error_message: {
            type: "string",
            description: "Any error messages or stack traces",
          },
        },
        required: ["issue_description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_schema_change",
      description: "ADMIN ONLY: Suggest database schema changes or improvements. Use this when admin asks about database structure modifications.",
      parameters: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "Name of the table to modify",
          },
          change_description: {
            type: "string",
            description: "What needs to be changed and why",
          },
          migration_sql: {
            type: "string",
            description: "Proposed SQL migration code",
          },
        },
        required: ["change_description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_application_logs",
      description: "ADMIN ONLY: Analyze application logs and error patterns to identify systemic issues.",
      parameters: {
        type: "object",
        properties: {
          time_range: {
            type: "string",
            description: "Time range to analyze (e.g., 'last 24 hours', 'last week')",
          },
          error_type: {
            type: "string",
            description: "Specific error type to focus on",
          },
        },
      },
    },
  },
];

// Execute tools by querying Supabase
async function executeTool(toolName: string, args: any, supabaseClient: any, isAdmin: boolean = false) {
  console.log(`Executing tool: ${toolName}`, JSON.stringify(args));

  // Admin-only tool protection
  const adminOnlyTools = ['diagnose_code_issue', 'suggest_schema_change', 'analyze_application_logs'];
  if (adminOnlyTools.includes(toolName) && !isAdmin) {
    throw new Error(`Access denied: ${toolName} requires admin privileges`);
  }

  try {
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

      if (entityError) {
        console.error("Entity search error:", entityError);
        throw new Error(`Failed to search entities: ${entityError.message}`);
      }
      
      if (!entities || entities.length === 0) {
        return { 
          success: false,
          message: `No entity found matching "${args.entity_name}". You may need to create this entity first in the [Entities](/entities) page.`,
          signals: [] 
        };
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

      if (mentionsError) {
        console.error("Entity mentions search error:", mentionsError);
        throw new Error(`Failed to search entity mentions: ${mentionsError.message}`);
      }

      if (!mentions || mentions.length === 0) {
        return { 
          success: true,
          entities: entities,
          message: `Found entity "${entities[0].name}" (${entities[0].type}) but no intelligence signals mention this entity yet. You can perform an OSINT scan to gather intelligence.`,
          signals: [],
          suggestion: `Try: "Perform an OSINT scan on ${entities[0].name}" to gather intelligence from the web.`
        };
      }

      // Get the actual signals
      const signalIds = [...new Set(mentions.map((m: any) => m.signal_id))];
      const { data: signals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, title, description, severity, received_at, status, category, client_id, clients(name)")
        .in("id", signalIds)
        .order("received_at", { ascending: false });

      if (signalsError) {
        console.error("Signals fetch error:", signalsError);
        throw new Error(`Failed to fetch signals: ${signalsError.message}`);
      }

      return {
        success: true,
        entities: entities,
        entity_mentions_count: mentions.length,
        signals: signals || [],
        message: `Found ${signals?.length || 0} signal(s) mentioning ${entities[0].name}`
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

      if (findError) {
        console.error("Entity lookup error for OSINT scan:", findError);
        if (findError.code === 'PGRST116') {
          return { 
            success: false, 
            message: `No entity found matching "${args.entity_name}". Please create this entity first in the [Entities](/entities) page, then I can perform an OSINT scan.`,
            note: "OSINT scans require an existing entity in the system."
          };
        }
        throw new Error(`Failed to lookup entity: ${findError.message}`);
      }
      
      if (!entity) {
        return { 
          success: false, 
          message: `No entity found matching "${args.entity_name}". Please create the entity first using [Create Entity](/entities).`,
          note: "OSINT scans require an existing entity in the system."
        };
      }

      // Trigger the OSINT scan
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      console.log(`Triggering OSINT scan for entity: ${entity.name} (${entity.id})`);
      
      try {
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
          console.error('OSINT scan HTTP error:', scanResponse.status, errorText);
          
          // Check if it's a configuration error
          if (errorText.includes('Google Search API not configured') || errorText.includes('GOOGLE_SEARCH')) {
            return {
              success: false,
              message: `OSINT scanning requires Google Search API configuration. The system administrator needs to configure GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID in the backend settings.`,
              entity: entity.name,
              error_type: "configuration"
            };
          }
          
          if (scanResponse.status === 404) {
            return {
              success: false,
              message: `The OSINT scan service is not available. Please contact your administrator.`,
              entity: entity.name,
              error_type: "service_unavailable"
            };
          }
          
          return { 
            success: false, 
            message: `OSINT scan failed for ${entity.name}. Status: ${scanResponse.status}. Details: ${errorText.substring(0, 200)}`,
            entity: entity.name,
            error_type: "scan_failed"
          };
        }

        const result = await scanResponse.json();
        console.log('OSINT scan result:', result);
        
        return {
          success: true,
          message: `✅ OSINT scan completed successfully for ${entity.name}!\n\n📊 Results:\n- ${result.content_created || 0} intelligence items created\n- ${result.signals_created || 0} security signals generated\n\nView the intelligence in [Entity Content](/entities) or check [Signals](/signals) for any security concerns.`,
          entity: entity.name,
          content_created: result.content_created || 0,
          signals_created: result.signals_created || 0
        };
      } catch (fetchError) {
        console.error('OSINT scan fetch error:', fetchError);
        return {
          success: false,
          message: `Failed to connect to OSINT scan service for ${entity.name}. Error: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`,
          entity: entity.name,
          error_type: "network_error"
        };
      }
    }

    case "create_entity": {
      const { data, error } = await supabaseClient
        .from("entities")
        .insert({
          name: args.name,
          type: args.type,
          description: args.description,
          aliases: args.aliases || [],
          risk_level: args.risk_level || "low",
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Created entity: ${data.name}\n\nView it here: [${data.name}](/entities)`,
        entity: data,
      };
    }

    case "update_entity": {
      const { data, error } = await supabaseClient
        .from("entities")
        .update(args.updates)
        .eq("id", args.entity_id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Updated entity: ${data.name}`,
        entity: data,
      };
    }

    case "create_incident": {
      const { data, error } = await supabaseClient
        .from("incidents")
        .insert({
          title: args.title,
          summary: args.summary,
          priority: args.priority,
          severity_level: args.severity_level || args.priority.toUpperCase(),
          client_id: args.client_id || null,
          status: "open",
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Created incident: ${data.title}\n\nPriority: ${data.priority}\n\nView it here: [Incident ${data.title}](/incidents)`,
        incident: data,
      };
    }

    case "update_incident": {
      const updates: any = {};
      
      if (args.status) {
        updates.status = args.status;
        if (args.status === "acknowledged") updates.acknowledged_at = new Date().toISOString();
        if (args.status === "contained") updates.contained_at = new Date().toISOString();
        if (args.status === "resolved") updates.resolved_at = new Date().toISOString();
      }
      
      if (args.summary) updates.summary = args.summary;

      const { data, error } = await supabaseClient
        .from("incidents")
        .update(updates)
        .eq("id", args.incident_id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Updated incident status to: ${data.status}`,
        incident: data,
      };
    }

    case "create_investigation": {
      const { data, error } = await supabaseClient
        .from("investigations")
        .insert({
          file_number: args.file_number,
          synopsis: args.synopsis,
          client_id: args.client_id || null,
          incident_id: args.incident_id || null,
          file_status: "open",
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Created investigation file: ${data.file_number}\n\nView it here: [Investigation ${data.file_number}](/investigations)`,
        investigation: data,
      };
    }

    case "update_signal_status": {
      const updates: any = {};
      if (args.is_reviewed !== undefined) updates.is_reviewed = args.is_reviewed;
      if (args.is_false_positive !== undefined) updates.is_false_positive = args.is_false_positive;

      const { data, error } = await supabaseClient
        .from("signals")
        .update(updates)
        .eq("id", args.signal_id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Updated signal status`,
        signal: data,
      };
    }

    case "link_entity_relationship": {
      // Find both entities
      const { data: entityA, error: errorA } = await supabaseClient
        .from("entities")
        .select("id, name")
        .ilike("name", `%${args.entity_a_name}%`)
        .limit(1)
        .single();

      if (errorA) throw new Error(`Entity A not found: ${args.entity_a_name}`);

      const { data: entityB, error: errorB } = await supabaseClient
        .from("entities")
        .select("id, name")
        .ilike("name", `%${args.entity_b_name}%`)
        .limit(1)
        .single();

      if (errorB) throw new Error(`Entity B not found: ${args.entity_b_name}`);

      // Create relationship
      const { data, error } = await supabaseClient
        .from("entity_relationships")
        .insert({
          entity_a_id: entityA.id,
          entity_b_id: entityB.id,
          relationship_type: args.relationship_type,
          description: args.description,
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Linked relationship: ${entityA.name} → ${args.relationship_type} → ${entityB.name}`,
        relationship: data,
      };
    }

    case "diagnose_code_issue": {
      // Admin-only diagnostic tool
      const analysis = {
        component: args.component_name || "Unknown",
        issue: args.issue_description,
        error: args.error_message || "No error message provided",
      };

      return {
        success: true,
        message: `🔍 Code Issue Analysis:\n\n**Component:** ${analysis.component}\n**Issue:** ${analysis.issue}\n\n**Diagnosis:**\nI've analyzed the issue. Here's what I found:\n\n1. **Root Cause:** The error suggests a problem with [specific area]\n2. **Affected Areas:** [list components/files]\n3. **Recommended Fix:** [specific steps]\n\n**Suggested Code Changes:**\n\`\`\`typescript\n// Add your fix here based on the issue\n\`\`\`\n\n⚠️ **Important:** This is a suggestion. Please review carefully before applying changes.`,
        analysis,
      };
    }

    case "suggest_schema_change": {
      // Admin-only schema suggestion tool
      return {
        success: true,
        message: `📊 Database Schema Suggestion:\n\n**Table:** ${args.table_name || 'Multiple tables'}\n**Proposed Change:** ${args.change_description}\n\n**Recommended SQL Migration:**\n\`\`\`sql\n${args.migration_sql || '-- Analyze the requirement and provide SQL here'}\n\`\`\`\n\n**Impact Analysis:**\n- Affects existing data: [Yes/No]\n- Requires backfill: [Yes/No]\n- Breaking change: [Yes/No]\n\n⚠️ **Critical:** Test in development environment before applying to production.\n\n**Steps to Apply:**\n1. Review the SQL carefully\n2. Test on development database\n3. Create backup of production data\n4. Apply migration during maintenance window`,
        suggestion: {
          table: args.table_name,
          change: args.change_description,
          sql: args.migration_sql,
        },
      };
    }

    case "analyze_application_logs": {
      // Query recent monitoring history and bug reports for patterns
      const { data: recentErrors } = await supabaseClient
        .from("monitoring_history")
        .select("*")
        .eq("status", "error")
        .order("created_at", { ascending: false })
        .limit(50);

      const { data: bugReports } = await supabaseClient
        .from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      return {
        success: true,
        message: `📈 Application Log Analysis:\n\n**Error Patterns Found:**\n${recentErrors?.length || 0} recent errors in monitoring history\n${bugReports?.length || 0} bug reports\n\n**Common Issues:**\n${recentErrors?.slice(0, 5).map((e: any) => `- ${e.source_name}: ${e.error_message}`).join('\n') || 'No recent errors'}\n\n**Recommendations:**\n1. Review rate limiting for external APIs\n2. Check authentication token expiration\n3. Monitor database connection pool\n4. Review edge function timeouts\n\n**Health Status:** ${(recentErrors?.length || 0) > 10 ? '⚠️ Needs attention' : '✅ Healthy'}`,
        errors: recentErrors,
        bugs: bugReports,
      };
    }


    default:
      throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Tool execution error for ${toolName}:`, error);
    throw error;
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

    // Get the authorization header to check user role
    const authHeader = req.headers.get("Authorization");
    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // Check if user is admin
    let isAdmin = false;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseClient.auth.getUser(token);
      
      if (user) {
        const { data: roles } = await supabaseClient
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single();
        
        isAdmin = !!roles;
      }
    }

    // Process messages to extract file attachments and format properly
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const fileAttachmentRegex = /📎 [^:]+: ([^\n]+)\nURL: ([^\n]+)/g;
        
        const imageUrls: string[] = [];
        const otherFiles: Array<{name: string, url: string}> = [];
        let match;
        
        // Extract images
        while ((match = imageRegex.exec(msg.content)) !== null) {
          const url = match[2];
          if (url && (url.includes('ai-chat-attachments') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
            imageUrls.push(url);
          }
        }
        
        // Extract other files
        while ((match = fileAttachmentRegex.exec(msg.content)) !== null) {
          otherFiles.push({ name: match[1], url: match[2] });
        }
        
        // Format message with multimodal content if attachments present
        if (imageUrls.length > 0 && msg.role === 'user') {
          let textContent = msg.content
            .replace(imageRegex, '')
            .replace(fileAttachmentRegex, '')
            .replace(/Attachments:\s*/g, '')
            .replace(/Please analyze these attachments:\s*/g, '')
            .trim();
          
          // Add context about other files
          if (otherFiles.length > 0) {
            const fileList = otherFiles.map(f => `- ${f.name}: ${f.url}`).join('\n');
            textContent += `\n\nAttached files:\n${fileList}`;
          }
          
          const contentParts: any[] = [];
          
          if (textContent) {
            contentParts.push({ type: "text", text: textContent });
          }
          
          // Add images for vision processing
          for (const imageUrl of imageUrls) {
            contentParts.push({
              type: "image_url",
              image_url: { url: imageUrl }
            });
          }
          
          return {
            role: msg.role,
            content: contentParts.length > 0 ? contentParts : msg.content
          };
        }
        
        return msg;
      })
    );

    // Filter tools based on admin status
    const adminOnlyTools = ['diagnose_code_issue', 'suggest_schema_change', 'analyze_application_logs'];
    const availableTools = isAdmin 
      ? tools 
      : tools.filter(tool => !adminOnlyTools.includes(tool.function.name));

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

CRITICAL DISTINCTIONS:
1. CLIENTS are organizations actively monitored by Fortress (customers)
2. ENTITIES are people/organizations mentioned in intelligence data
3. When users ask about a person "of/at [organization]", search for the ENTITY (person), not the client

You have access to tools to query AND MODIFY the database for:

QUERY CAPABILITIES:
- Recent security signals
- Signals related to specific entities or people
- Entity information (people, organizations, locations)
- Active incidents
- Investigation files
- Client accounts
- System monitoring status and health
- Error diagnostics and troubleshooting
- OSINT (Open Source Intelligence) scanning capabilities

DATA MODIFICATION CAPABILITIES:
- Create new entities (people, organizations, locations, vehicles, events)
- Update existing entity information (descriptions, risk levels, aliases)
- Create security incidents
- Update incident status (acknowledge, contain, resolve)
- Create investigation files
- Update signal status (mark as reviewed, false positive)
- Link relationships between entities

${isAdmin ? `
ADMIN-ONLY CAPABILITIES (CURRENT USER IS ADMIN):
You have special administrative access to:
- Diagnose and analyze system issues (bugs, errors, performance problems)
- Suggest code fixes for React components
- Recommend database schema changes
- Propose new features and improvements

When diagnosing issues:
1. Identify the problem clearly
2. Explain the root cause
3. Suggest specific fixes with code examples
4. Warn about potential side effects

IMPORTANT: You can suggest and explain fixes, but the admin must review and approve all code/schema changes.
` : ''}

FILE ATTACHMENTS:
- Analyze attached images for security-relevant information
- Look for threats, suspicious activity, or concerning details in images
- For PDF documents: Use the parse_pdf_document tool to extract and analyze text content
- Provide insights on documents and their security implications
- Reference attachments when providing responses

IMPORTANT: When you see "PDF Documents to analyze:" in a message, you MUST call parse_pdf_document for each PDF URL to read its content before responding.

OSINT SCANNING:
When users ask to gather intelligence, perform research, or look for information about a person or organization:
1. First check if the entity exists in the system using search_entities
2. If it exists, use search_signals_by_entity to check for existing signals
3. If no signals exist, use trigger_osint_scan to perform a comprehensive web search
4. The OSINT scan will search multiple sources including social media, news, and public records
5. Results are automatically processed and added as entity content and signals
6. If OSINT scanning is not configured, inform the user it requires Google Search API setup

WHEN USERS ASK ABOUT A PERSON OR ORGANIZATION:
- Example: "Find hazards for Lloyd Clark of Pink Mountain Outfitters"
- Action: Use search_entities to find "Lloyd Clark" (the person is the entity)
- Then: Use search_signals_by_entity or trigger_osint_scan
- DO NOT try to search by client unless they specifically ask about monitoring a client organization

CREATING AND MODIFYING DATA:
When users ask to:
- "Add [entity name]" → Use create_entity
- "Create an incident for [description]" → Use create_incident  
- "Acknowledge incident [id]" → Use update_incident with status: acknowledged
- "Mark signal as false positive" → Use update_signal_status
- "Link [entity A] to [entity B]" → Use link_entity_relationship
- "Start an investigation" → Use create_investigation

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
When troubleshooting, be specific about what you found and how to fix it.
When making changes, confirm what you did and provide links to view the results.`,
          },
          ...processedMessages,
        ],
        tools: availableTools,
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
            const result = await executeTool(toolCall.function.name, args, supabaseClient, isAdmin);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify(result),
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            console.error(`Tool execution error for ${toolCall.function.name}:`, errorMessage, error);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify({ 
                success: false,
                error: errorMessage,
                error_details: error instanceof Error ? error.stack : String(error)
              }),
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
            content: `You are a helpful security intelligence assistant with data modification capabilities. 

You can:
- Create and update entities, incidents, and investigations
- Mark signals as reviewed or false positive
- Link relationships between entities
- Query system data and troubleshoot issues
- Analyze file attachments for security insights
${isAdmin ? `
- ADMIN ACCESS: Diagnose code issues and suggest fixes
- ADMIN ACCESS: Recommend database schema changes
- ADMIN ACCESS: Analyze application logs and errors
` : ''}

Summarize the tool results in a clear, conversational way. Use markdown links for navigation: [Link Text](/path). Be concise and helpful. When file attachments are present, incorporate insights from them into your response. When making changes, confirm what you did and provide links to view the results.`,
          },
          ...processedMessages,
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
            content: `You are a helpful security intelligence assistant with data modification and troubleshooting capabilities. 

You can:
- Create and update entities, incidents, and investigations
- Mark signals as reviewed or false positive
- Link relationships between entities
- Diagnose system issues and provide recommendations
- Analyze file attachments including images and PDF documents

Use plain, conversational language. Provide navigation links when relevant using markdown format: [Link Text](/path). When diagnosing issues, be specific and actionable. When file attachments are present, analyze them and provide relevant security insights. When making changes, confirm what you did.`,
          },
          ...processedMessages,
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
