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
      name: "analyze_database_issues",
      description: "Analyze the database for common issues like duplicate signals, orphaned records, and data quality problems. Use this when users ask about database issues, duplicates, or system data integrity.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            enum: ["duplicates", "orphaned_records", "data_quality", "all"],
            description: "Type of issue to analyze for (default: all)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fix_duplicate_signals",
      description: "Merge or remove duplicate signals identified in the system. Use after analyzing duplicates.",
      parameters: {
        type: "object",
        properties: {
          signal_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of duplicate signal IDs to fix",
          },
          action: {
            type: "string",
            enum: ["merge", "mark_as_duplicate", "delete_duplicates"],
            description: "Action to take on duplicates",
          },
          keep_signal_id: {
            type: "string",
            description: "ID of the signal to keep when merging (optional, uses first if not specified)",
          },
        },
        required: ["signal_ids", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_signal_quality",
      description: "Analyze signal quality metrics and identify low-quality or potentially false positive signals. Use for data quality reviews.",
      parameters: {
        type: "object",
        properties: {
          days_back: {
            type: "number",
            description: "Number of days to analyze (default 7)",
          },
          min_confidence: {
            type: "number",
            description: "Minimum confidence threshold 0-1 (default 0.5)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the knowledge base for articles, procedures, best practices, and documentation. Use this when users ask questions about how to do something, need guidance, or want to reference documentation.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for article title, content, or tags",
          },
          category_id: {
            type: "string",
            description: "Optional: Filter by specific category UUID",
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
      name: "get_knowledge_base_categories",
      description: "Get all knowledge base categories to understand available topics and organization. Use when users want to browse or understand what documentation is available.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_database_schema",
      description: "Get information about database tables, columns, relationships, and their purposes. Use when users ask about data structure, how features are implemented, or what data is stored.",
      parameters: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "Optional: specific table name to get detailed column info for",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_edge_functions",
      description: "List all available edge functions and their purposes. Use when users ask about backend functionality, automation, or how specific features work.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_feature",
      description: "Explain how a specific platform feature works, its components, data flow, and implementation. Use when users ask how features are designed or implemented.",
      parameters: {
        type: "object",
        properties: {
          feature_name: {
            type: "string",
            description: "Name of the feature (e.g., 'signals', 'incidents', 'entities', 'travel', 'investigations', 'monitoring')",
          },
        },
        required: ["feature_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_architecture",
      description: "Get overview of the platform's architecture, technology stack, and how components interact. Use when users ask about the overall system design or technical implementation.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// Execute tools by querying Supabase
async function executeTool(toolName: string, args: any, supabaseClient: any) {
  console.log(`Executing tool: ${toolName}`, JSON.stringify(args));

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

    case "analyze_database_issues": {
      const issueType = args.issue_type || "all";
      const issues: any = { duplicate_signals: [], orphaned_records: [], data_quality: [] };

      // Check for duplicate signals based on content hash
      if (issueType === "duplicates" || issueType === "all") {
        const { data: duplicates } = await supabaseClient
          .from("signals")
          .select("content_hash, id, title, created_at, confidence")
          .not("content_hash", "is", null)
          .order("created_at", { ascending: false })
          .limit(500);

        if (duplicates) {
          const hashMap = new Map();
          duplicates.forEach((signal: any) => {
            if (!hashMap.has(signal.content_hash)) {
              hashMap.set(signal.content_hash, []);
            }
            hashMap.get(signal.content_hash).push(signal);
          });

          hashMap.forEach((signals, hash) => {
            if (signals.length > 1) {
              issues.duplicate_signals.push({
                hash,
                count: signals.length,
                signals: signals.map((s: any) => ({ 
                  id: s.id, 
                  title: s.title, 
                  created_at: s.created_at,
                  confidence: s.confidence 
                }))
              });
            }
          });
        }
      }

      // Check for orphaned records
      if (issueType === "orphaned_records" || issueType === "all") {
        const { data: orphanedMentions } = await supabaseClient
          .from("entity_mentions")
          .select("id, entity_id, signal_id, incident_id")
          .is("signal_id", null)
          .is("incident_id", null)
          .limit(100);

        if (orphanedMentions && orphanedMentions.length > 0) {
          issues.orphaned_records.push({
            type: "entity_mentions",
            count: orphanedMentions.length,
            details: "Entity mentions with no signal or incident reference",
            sample_ids: orphanedMentions.slice(0, 5).map((m: any) => m.id)
          });
        }
      }

      // Check data quality
      if (issueType === "data_quality" || issueType === "all") {
        const { data: lowQuality } = await supabaseClient
          .from("signals")
          .select("id, title, confidence, status, created_at")
          .lt("confidence", 0.3)
          .eq("status", "new")
          .order("created_at", { ascending: false })
          .limit(50);

        if (lowQuality && lowQuality.length > 0) {
          issues.data_quality.push({
            type: "low_confidence_signals",
            count: lowQuality.length,
            signals: lowQuality.slice(0, 10)
          });
        }

        // Check for signals with missing data
        const { data: incomplete } = await supabaseClient
          .from("signals")
          .select("id, title, description, category")
          .or("description.is.null,category.is.null")
          .order("created_at", { ascending: false })
          .limit(20);

        if (incomplete && incomplete.length > 0) {
          issues.data_quality.push({
            type: "incomplete_signals",
            count: incomplete.length,
            details: "Signals missing description or category"
          });
        }
      }

      return {
        success: true,
        issues,
        summary: `Found ${issues.duplicate_signals.length} duplicate groups (${issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0)} total duplicates), ${issues.orphaned_records.reduce((sum: number, r: any) => sum + r.count, 0)} orphaned records, ${issues.data_quality.reduce((sum: number, q: any) => sum + q.count, 0)} data quality issues`,
        total_duplicate_signals: issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0)
      };
    }

    case "fix_duplicate_signals": {
      const { signal_ids, action, keep_signal_id } = args;
      
      if (!signal_ids || signal_ids.length < 2) {
        return { success: false, error: "Need at least 2 signal IDs to fix duplicates" };
      }

      if (action === "mark_as_duplicate") {
        // Use the detect-duplicates function
        try {
          const { error: detectError } = await supabaseClient.functions.invoke("detect-duplicates", {
            body: { signal_ids }
          });

          if (detectError) {
            return { success: false, error: detectError.message };
          }

          return {
            success: true,
            message: `Marked ${signal_ids.length} signals as potential duplicates in duplicate_detections table`
          };
        } catch (error) {
          return { 
            success: false, 
            error: `Failed to mark duplicates: ${error instanceof Error ? error.message : 'Unknown error'}` 
          };
        }
      } else if (action === "delete_duplicates") {
        const primaryId = keep_signal_id || signal_ids[0];
        const toDelete = signal_ids.filter((id: string) => id !== primaryId);
        
        // Delete duplicate signals
        const { error: deleteError } = await supabaseClient
          .from("signals")
          .delete()
          .in("id", toDelete);

        if (deleteError) {
          return { success: false, error: deleteError.message };
        }

        return {
          success: true,
          message: `Deleted ${toDelete.length} duplicate signals, kept signal ${primaryId}`,
          kept_signal_id: primaryId,
          deleted_count: toDelete.length
        };
      } else if (action === "merge") {
        const primaryId = keep_signal_id || signal_ids[0];
        const otherIds = signal_ids.filter((id: string) => id !== primaryId);

        // Update entity mentions to point to primary signal
        const { error: mentionsError } = await supabaseClient
          .from("entity_mentions")
          .update({ signal_id: primaryId })
          .in("signal_id", otherIds);

        if (mentionsError) {
          return { success: false, error: `Failed to update mentions: ${mentionsError.message}` };
        }

        // Update incident_signals references
        const { error: incidentError } = await supabaseClient
          .from("incident_signals")
          .update({ signal_id: primaryId })
          .in("signal_id", otherIds);

        // Delete duplicate signals
        const { error: deleteError } = await supabaseClient
          .from("signals")
          .delete()
          .in("id", otherIds);

        if (deleteError) {
          return { success: false, error: `Failed to delete duplicates: ${deleteError.message}` };
        }

        return {
          success: true,
          message: `Merged ${signal_ids.length} signals into ${primaryId}. Updated entity mentions and incident references.`,
          primary_signal_id: primaryId,
          merged_count: otherIds.length
        };
      }

      return { success: false, error: "Invalid action specified. Use 'merge', 'mark_as_duplicate', or 'delete_duplicates'" };
    }

    case "analyze_signal_quality": {
      const daysBack = args.days_back || 7;
      const minConfidence = args.min_confidence || 0.5;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      const { data: recentSignals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, title, confidence, status, severity, created_at, source_id")
        .gte("created_at", cutoffDate.toISOString())
        .order("created_at", { ascending: false });

      if (signalsError || !recentSignals) {
        return { success: false, error: "Failed to fetch signals for analysis" };
      }

      const qualityMetrics = {
        total_signals: recentSignals.length,
        low_confidence: recentSignals.filter((s: any) => (s.confidence || 0) < minConfidence).length,
        high_confidence: recentSignals.filter((s: any) => (s.confidence || 0) >= 0.8).length,
        medium_confidence: recentSignals.filter((s: any) => (s.confidence || 0) >= minConfidence && (s.confidence || 0) < 0.8).length,
        by_status: {} as any,
        by_severity: {} as any,
        avg_confidence: recentSignals.length > 0 
          ? (recentSignals.reduce((sum: number, s: any) => sum + (s.confidence || 0), 0) / recentSignals.length).toFixed(3)
          : 0
      };

      recentSignals.forEach((signal: any) => {
        qualityMetrics.by_status[signal.status] = (qualityMetrics.by_status[signal.status] || 0) + 1;
        if (signal.severity) {
          qualityMetrics.by_severity[signal.severity] = (qualityMetrics.by_severity[signal.severity] || 0) + 1;
        }
      });

      const lowQualitySignals = recentSignals
        .filter((s: any) => (s.confidence || 0) < minConfidence)
        .slice(0, 10)
        .map((s: any) => ({
          id: s.id,
          title: s.title,
          confidence: s.confidence,
          created_at: s.created_at
        }));

      return {
        success: true,
        metrics: qualityMetrics,
        low_quality_signals: lowQualitySignals,
        analysis_period: `Last ${daysBack} days`,
        quality_percentage: recentSignals.length > 0 
          ? ((qualityMetrics.high_confidence / recentSignals.length) * 100).toFixed(1) + '%'
          : '0%'
      };
    }

    case "search_knowledge_base": {
      const searchQuery = args.query;
      const limit = args.limit || 10;
      
      let query = supabaseClient
        .from("knowledge_base_articles")
        .select(`
          id,
          title,
          summary,
          content,
          tags,
          created_at,
          view_count,
          helpful_count,
          knowledge_base_categories(name, icon)
        `)
        .eq("is_published", true)
        .order("helpful_count", { ascending: false })
        .limit(limit);

      // Filter by category if provided
      if (args.category_id) {
        query = query.eq("category_id", args.category_id);
      }

      // Search in title, summary, content, and tags
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,summary.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%,tags.cs.{${searchQuery}}`);
      }

      const { data: articles, error: searchError } = await query;

      if (searchError) {
        console.error("Knowledge base search error:", searchError);
        return { 
          success: false, 
          error: `Failed to search knowledge base: ${searchError.message}` 
        };
      }

      if (!articles || articles.length === 0) {
        return {
          success: true,
          articles: [],
          message: `No knowledge base articles found matching "${searchQuery}". Try browsing categories or using different keywords.`
        };
      }

      return {
        success: true,
        articles: articles.map((article: any) => ({
          id: article.id,
          title: article.title,
          summary: article.summary,
          content: article.content?.substring(0, 500) + (article.content?.length > 500 ? "..." : ""),
          category: article.knowledge_base_categories?.name,
          tags: article.tags,
          helpful_count: article.helpful_count,
          view_count: article.view_count,
          url: `/knowledge-base/${article.id}`
        })),
        count: articles.length,
        message: `Found ${articles.length} article(s) matching "${searchQuery}"`
      };
    }

    case "get_knowledge_base_categories": {
      const { data: categories, error: categoriesError } = await supabaseClient
        .from("knowledge_base_categories")
        .select(`
          id,
          name,
          description,
          icon,
          display_order,
          knowledge_base_articles(count)
        `)
        .order("display_order", { ascending: true });

      if (categoriesError) {
        console.error("Categories fetch error:", categoriesError);
        return { 
          success: false, 
          error: `Failed to fetch categories: ${categoriesError.message}` 
        };
      }

      if (!categories || categories.length === 0) {
        return {
          success: true,
          categories: [],
          message: "No knowledge base categories found. The knowledge base may be empty."
        };
      }

      return {
        success: true,
        categories: categories.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          description: cat.description,
          icon: cat.icon,
          article_count: cat.knowledge_base_articles?.length || 0
        })),
        count: categories.length,
        message: `Found ${categories.length} knowledge base categories`
      };
    }

    case "get_database_schema": {
      return {
        success: true,
        tables: [
          { 
            name: 'signals', 
            description: 'Security intelligence signals from various OSINT sources',
            key_columns: ['id', 'title', 'description', 'severity', 'status', 'client_id', 'received_at', 'confidence', 'content_hash', 'normalized_text'],
            relationships: ['Links to clients, sources, incidents via incident_signals, entities via entity_mentions']
          },
          { 
            name: 'incidents', 
            description: 'Security incidents created from signals requiring investigation',
            key_columns: ['id', 'title', 'status', 'priority', 'severity_level', 'opened_at', 'acknowledged_at', 'resolved_at', 'client_id', 'owner_user_id'],
            relationships: ['Links to signals via incident_signals, entities via incident_entities, clients, users']
          },
          { 
            name: 'entities', 
            description: 'Tracked entities (people, organizations, locations) with OSINT monitoring',
            key_columns: ['id', 'name', 'type', 'description', 'risk_level', 'threat_score', 'current_location', 'active_monitoring_enabled'],
            relationships: ['Links to signals/incidents via entity_mentions, has entity_content, entity_photos, entity_relationships']
          },
          { 
            name: 'entity_mentions', 
            description: 'Links between entities and signals/incidents where they are mentioned',
            key_columns: ['id', 'entity_id', 'signal_id', 'incident_id', 'confidence', 'context', 'detected_at'],
            relationships: ['Many-to-many join table connecting entities to signals and incidents']
          },
          { 
            name: 'entity_relationships', 
            description: 'Relationships between entities (e.g., person works for organization)',
            key_columns: ['id', 'entity_a_id', 'entity_b_id', 'relationship_type', 'strength', 'first_observed', 'last_observed'],
            relationships: ['Self-referencing entities table creating a graph of relationships']
          },
          { 
            name: 'entity_content', 
            description: 'OSINT content found about entities (articles, social posts, etc.)',
            key_columns: ['id', 'entity_id', 'content_type', 'url', 'title', 'content_text', 'sentiment', 'relevance_score'],
            relationships: ['Belongs to entities, created by automated OSINT scans']
          },
          { 
            name: 'entity_photos', 
            description: 'Photos of entities collected from OSINT sources',
            key_columns: ['id', 'entity_id', 'storage_path', 'source', 'caption'],
            relationships: ['Belongs to entities, stored in Supabase Storage']
          },
          { 
            name: 'clients', 
            description: 'Client organizations being monitored by the platform',
            key_columns: ['id', 'name', 'industry', 'status', 'locations', 'monitoring_keywords', 'threat_profile'],
            relationships: ['Has many signals, incidents, investigations, travelers']
          },
          { 
            name: 'investigations', 
            description: 'Investigation case files with timeline and evidence',
            key_columns: ['id', 'file_number', 'synopsis', 'recommendations', 'file_status', 'client_id', 'incident_id'],
            relationships: ['Links to clients, incidents, has investigation_entries, investigation_persons, investigation_attachments']
          },
          { 
            name: 'investigation_entries', 
            description: 'Timeline entries in investigation files',
            key_columns: ['id', 'investigation_id', 'entry_text', 'entry_timestamp', 'is_ai_generated'],
            relationships: ['Belongs to investigations, chronological log']
          },
          { 
            name: 'travelers', 
            description: 'Personnel who travel and need risk monitoring',
            key_columns: ['id', 'name', 'email', 'department', 'risk_level', 'is_active'],
            relationships: ['Has many itineraries']
          },
          { 
            name: 'itineraries', 
            description: 'Travel itineraries with risk assessments',
            key_columns: ['id', 'traveler_id', 'trip_name', 'destination_country', 'destination_city', 'departure_date', 'return_date', 'risk_level', 'monitoring_enabled'],
            relationships: ['Belongs to travelers, AI-analyzed for risks']
          },
          { 
            name: 'sources', 
            description: 'OSINT data sources being monitored',
            key_columns: ['id', 'name', 'type', 'url', 'status', 'scan_frequency', 'last_ingested_at'],
            relationships: ['Produces signals, has monitoring_history']
          },
          { 
            name: 'monitoring_history', 
            description: 'History of automated monitoring scans',
            key_columns: ['id', 'source_name', 'status', 'scan_started_at', 'scan_completed_at', 'items_scanned', 'signals_created'],
            relationships: ['Tracks automation performance per source']
          },
          { 
            name: 'knowledge_base_articles', 
            description: 'Platform documentation and guides',
            key_columns: ['id', 'title', 'content', 'summary', 'category_id', 'tags', 'is_published'],
            relationships: ['Belongs to knowledge_base_categories, searchable content']
          },
          { 
            name: 'archival_documents', 
            description: 'Historical documents and intelligence reports',
            key_columns: ['id', 'filename', 'content_text', 'summary', 'keywords', 'entity_mentions', 'date_of_document'],
            relationships: ['Can be linked to entities, searchable content repository']
          },
          { 
            name: 'automation_metrics', 
            description: 'Performance metrics for automation and AI systems',
            key_columns: ['id', 'metric_date', 'signals_processed', 'incidents_created', 'osint_scans_completed', 'false_positive_rate'],
            relationships: ['Aggregated daily metrics for monitoring system health']
          }
        ],
        message: args.table_name 
          ? `Detailed schema information for ${args.table_name}. This table is part of the Fortress security intelligence platform's data model.`
          : 'Complete database schema overview. Fortress uses PostgreSQL with Row Level Security (RLS) for data access control.'
      };
    }

    case "list_edge_functions": {
      return {
        success: true,
        functions: [
          { 
            name: 'ingest-signal', 
            purpose: 'Ingest new security signals into the system from various sources',
            triggers: 'API calls, manual uploads, monitoring functions',
            processes: 'Validates, normalizes, hashes content, extracts entities, calculates severity'
          },
          { 
            name: 'correlate-signals', 
            purpose: 'Find and group related signals using content similarity',
            triggers: 'Automatically after signal ingestion',
            processes: 'Content hash matching, text normalization, grouping into correlation_groups'
          },
          { 
            name: 'correlate-entities', 
            purpose: 'Link entities to signals and incidents using NLP',
            triggers: 'After signal/incident creation',
            processes: 'Named entity recognition, keyword matching, creates entity_mentions'
          },
          { 
            name: 'ai-decision-engine', 
            purpose: 'AI-powered incident creation and escalation decisions',
            triggers: 'When new signals arrive or patterns detected',
            processes: 'Analyzes signal patterns, assesses threat level, creates incidents automatically'
          },
          { 
            name: 'check-incident-escalation', 
            purpose: 'Check if incidents need escalation based on rules and SLAs',
            triggers: 'Scheduled (every 15 minutes)',
            processes: 'Evaluates escalation_rules, checks SLA timers, triggers escalations'
          },
          { 
            name: 'alert-delivery', 
            purpose: 'Send alerts via email, Slack, Teams',
            triggers: 'Incident creation, escalation, manual alerts',
            processes: 'Formats messages, delivers to configured channels, tracks delivery status'
          },
          { 
            name: 'monitor-news', 
            purpose: 'Automated monitoring of news sources for relevant threats',
            triggers: 'Scheduled (configurable frequency)',
            processes: 'RSS feeds, news APIs, keyword matching, signal generation'
          },
          { 
            name: 'monitor-social', 
            purpose: 'Monitor social media platforms for entity mentions',
            triggers: 'Scheduled scans',
            processes: 'Twitter, LinkedIn, Facebook APIs, sentiment analysis'
          },
          { 
            name: 'monitor-threat-intel', 
            purpose: 'Ingest threat intelligence feeds',
            triggers: 'Scheduled',
            processes: 'CVE databases, threat feeds, indicator matching'
          },
          { 
            name: 'monitor-darkweb', 
            purpose: 'Scan dark web sources for credential leaks and threats',
            triggers: 'Scheduled',
            processes: 'Searches Tor, paste sites, breach databases'
          },
          { 
            name: 'osint-entity-scan', 
            purpose: 'Comprehensive OSINT scan for entity information',
            triggers: 'Manual or scheduled for monitored entities',
            processes: 'Multi-source web search, data collection, entity_content creation'
          },
          { 
            name: 'scan-entity-content', 
            purpose: 'Scan web content for specific entities',
            triggers: 'Part of OSINT scans',
            processes: 'Web scraping, content analysis, relevance scoring'
          },
          { 
            name: 'scan-entity-photos', 
            purpose: 'Find and collect photos of entities',
            triggers: 'Part of OSINT scans',
            processes: 'Image search APIs, face detection, storage in entity_photos'
          },
          { 
            name: 'enrich-entity', 
            purpose: 'Enrich entity data from multiple sources',
            triggers: 'Manual enrichment requests',
            processes: 'Combines data from APIs, public records, social profiles'
          },
          { 
            name: 'parse-document', 
            purpose: 'Extract text and entities from uploaded documents',
            triggers: 'Document uploads',
            processes: 'OCR, text extraction, NLP, creates ingested_documents and entity mentions'
          },
          { 
            name: 'process-client-onboarding', 
            purpose: 'Process new client onboarding data',
            triggers: 'Client onboarding form submission',
            processes: 'Creates monitoring keywords, risk profiles, initial entity setup'
          },
          { 
            name: 'generate-report', 
            purpose: 'Generate security reports (PDF/DOCX)',
            triggers: 'Manual report requests',
            processes: 'Queries data, formats report, generates PDF/DOCX'
          },
          { 
            name: 'generate-executive-report', 
            purpose: 'Generate executive-level summary reports',
            triggers: 'Scheduled or manual',
            processes: 'Aggregates metrics, creates executive summary, formats for leadership'
          },
          { 
            name: 'dashboard-ai-assistant', 
            purpose: 'AI assistant for platform interaction and queries',
            triggers: 'User messages in dashboard',
            processes: 'Natural language understanding, database queries, contextual responses'
          },
          { 
            name: 'investigation-ai-assist', 
            purpose: 'AI assistance for investigation writing',
            triggers: 'Investigation page AI features',
            processes: 'Expands notes, suggests next steps, writes synopses'
          },
          { 
            name: 'parse-travel-itinerary', 
            purpose: 'Parse and analyze travel itineraries',
            triggers: 'Travel document upload',
            processes: 'Extracts dates, locations, flights, assesses risks'
          },
          { 
            name: 'monitor-travel-risks', 
            purpose: 'Monitor risks for active travelers',
            triggers: 'Scheduled for active itineraries',
            processes: 'Checks threat intel, weather, civil unrest for traveler locations'
          }
        ],
        message: 'Complete list of edge functions that power Fortress automation and AI capabilities. All functions are Deno-based and auto-deployed.'
      };
    }

    case "explain_feature": {
      const featureName = args.feature_name?.toLowerCase();
      const featureExplanations: Record<string, any> = {
        signals: {
          description: 'Signals are raw security intelligence ingested from various OSINT sources (news, social media, threat intel, etc.). They represent potential security events or threats that need analysis.',
          components: [
            'Signal ingestion (ingest-signal function)',
            'Signal correlation (correlate-signals function)',
            'Entity detection (correlate-entities function)',
            'Duplicate detection (detect-duplicates function)',
            'Quality scoring and confidence calculation'
          ],
          data_flow: 'OSINT Source → Monitor Function → Ingest Signal → Normalize/Hash Content → Correlate with Existing → Extract Entities → Calculate Severity → Store in signals table → Trigger AI Decision Engine',
          tables: ['signals', 'signal_correlation_groups', 'entity_mentions', 'signal_documents', 'incident_signals'],
          key_functions: ['ingest-signal', 'correlate-signals', 'correlate-entities', 'detect-duplicates', 'ai-decision-engine'],
          ui_pages: ['Signals page (/signals) - List view, filtering, detail dialogs', 'Dashboard - Recent signals widget'],
          how_to_use: 'Signals are automatically created by monitoring functions. Users can view, filter, search, mark false positives, and manually create incidents from signals.'
        },
        incidents: {
          description: 'Incidents are security events that require investigation, response, and tracking. Created automatically by AI or manually from signals.',
          components: [
            'AI-powered incident creation (ai-decision-engine)',
            'Escalation rules engine (check-incident-escalation)',
            'Alert delivery system (alert-delivery)',
            'SLA tracking and timers',
            'Status workflow (open → investigating → contained → resolved)',
            'Priority system (p1/p2/p3/p4)'
          ],
          data_flow: 'Correlated Signals → AI Decision Engine → Create Incident → Link Signals/Entities → Check Escalation Rules → Send Alerts → Track Status Changes → Monitor SLA → Resolution',
          tables: ['incidents', 'incident_signals', 'incident_entities', 'alerts', 'escalation_rules', 'incident_outcomes'],
          key_functions: ['ai-decision-engine', 'check-incident-escalation', 'alert-delivery', 'incident-action'],
          ui_pages: ['Incidents page (/incidents) - List, detail view, status updates', 'Dashboard - Active incidents count'],
          how_to_use: 'Incidents are created automatically based on signal patterns. Users can assign owners, update status, add notes, link to investigations, and track resolution.'
        },
        entities: {
          description: 'Entities are tracked people, organizations, or locations with comprehensive OSINT enrichment and relationship mapping.',
          components: [
            'Entity management and profiles',
            'OSINT scanning (osint-entity-scan, osint-web-search)',
            'Content collection (scan-entity-content)',
            'Photo collection (scan-entity-photos)',
            'Relationship mapping (entity_relationships)',
            'Active monitoring with proximity alerts'
          ],
          data_flow: 'Create Entity → Set Monitoring Radius → Trigger OSINT Scan → Collect Web Content → Extract Photos → Detect Relationships → Link to Signals/Incidents → Track Mentions → Alert on Proximity',
          tables: ['entities', 'entity_mentions', 'entity_relationships', 'entity_content', 'entity_photos', 'entity_suggestions'],
          key_functions: ['osint-entity-scan', 'osint-web-search', 'scan-entity-content', 'scan-entity-photos', 'enrich-entity', 'cross-reference-entities', 'monitor-entity-proximity'],
          ui_pages: [
            'Entities page (/entities) - List view, search, create dialog',
            'Entity detail dialog - Profile, content, photos, relationships, mentions',
            'Entity unified profile - Comprehensive view'
          ],
          how_to_use: 'Create entities for people/orgs to track. Enable active monitoring. System automatically performs OSINT scans, collects intelligence, detects mentions in signals, and alerts on proximity to incidents.'
        },
        travel: {
          description: 'Travel security monitoring tracks personnel traveling to potentially risky locations with real-time risk assessment and alerts.',
          components: [
            'Traveler management',
            'Itinerary tracking with dates and locations',
            'AI risk assessment (parse-travel-itinerary)',
            'Real-time monitoring (monitor-travel-risks)',
            'Travel alerts for destination risks',
            'Map visualization of traveler locations'
          ],
          data_flow: 'Create Traveler → Add Itinerary (manual or upload) → AI Parse & Risk Assessment → Enable Monitoring → Monitor Risks Function Checks Threats → Generate Travel Alerts → Display on Map → Archive After Return',
          tables: ['travelers', 'itineraries'],
          key_functions: ['parse-travel-itinerary', 'monitor-travel-risks', 'archive-completed-itineraries'],
          ui_pages: [
            'Travel page (/travel) - Travelers list, itineraries list',
            'Travel map - Geographic visualization',
            'Travel alerts panel - Risk notifications'
          ],
          how_to_use: 'Add travelers and their itineraries (manually or upload PDF/DOCX). System performs AI risk assessment, monitors threats at destinations, and sends alerts for risks.'
        },
        investigations: {
          description: 'Investigation case file management for documenting security investigations with timeline, persons, evidence, and AI writing assistance.',
          components: [
            'Investigation files with file numbers',
            'Timeline entries (investigation_entries)',
            'Person tracking (investigation_persons)',
            'Document attachments (investigation_attachments)',
            'AI writing assistance (investigation-ai-assist)',
            'Cross-references to other cases',
            'Entity correlation'
          ],
          data_flow: 'Create Investigation → Add Timeline Entries → Track Persons Involved → Upload Evidence → Use AI to Expand Notes/Write Synopsis → Link Entities → Add Recommendations → Generate Report',
          tables: ['investigations', 'investigation_entries', 'investigation_persons', 'investigation_attachments'],
          key_functions: ['investigation-ai-assist', 'suggest-investigation-references', 'generate-report'],
          ui_pages: [
            'Investigations page (/investigations) - List and search',
            'Investigation detail page (/investigations/:id) - Full case file interface'
          ],
          how_to_use: 'Create investigation from incident or standalone. Add chronological entries, track people, upload evidence. Use AI assistant to expand notes, suggest next steps, write synopsis and recommendations.'
        },
        monitoring: {
          description: 'Automated OSINT source monitoring continuously scans configured sources for security intelligence and generates signals.',
          components: [
            'Source configuration (sources table)',
            'Multiple source types (RSS, news APIs, social media, threat intel, dark web)',
            'Scheduled scanning based on frequency',
            'Monitoring history tracking',
            'Error detection and alerting',
            '20+ specialized monitor functions'
          ],
          data_flow: 'Configure Source → Set Scan Frequency → Monitor Function Scheduled → Scan Source → Extract Data → Match Keywords → Generate Signals → Record History → Handle Errors',
          tables: ['sources', 'monitoring_history', 'ingested_documents'],
          key_functions: [
            'monitor-news', 'monitor-social', 'monitor-threat-intel', 'monitor-darkweb',
            'monitor-facebook', 'monitor-instagram', 'monitor-linkedin', 'monitor-twitter',
            'monitor-pastebin', 'monitor-github', 'monitor-rss-sources', 'monitor-domains',
            'monitor-earthquakes', 'monitor-wildfires', 'monitor-weather', 'monitor-canadian-sources',
            'auto-orchestrator (coordinates all monitoring)'
          ],
          ui_pages: [
            'Sources page (/sources) - List sources, add/edit',
            'Monitoring Sources page (/monitoring-sources) - Detailed configuration',
            'Dashboard - Monitoring status widget'
          ],
          how_to_use: 'Add sources (RSS feeds, social accounts, etc.), configure scan frequency and keywords. System automatically monitors sources on schedule, generates signals for matches, tracks performance in monitoring_history.'
        },
        automation: {
          description: 'Comprehensive automation system that orchestrates all OSINT monitoring, signal processing, incident creation, and alerting without manual intervention.',
          components: [
            'Auto-orchestrator (master coordinator)',
            'Scheduled edge functions',
            'AI decision engine',
            'Processing queue',
            'Automation metrics tracking',
            'Adaptive confidence adjustment',
            'Learning profiles for ML improvements'
          ],
          data_flow: 'Auto-Orchestrator → Trigger Monitor Functions → Ingest Signals → Correlate → Entity Detection → AI Decision → Create Incidents → Check Escalation → Send Alerts → Record Metrics',
          tables: ['monitoring_history', 'automation_metrics', 'processing_queue', 'learning_profiles'],
          key_functions: [
            'auto-orchestrator', 'adaptive-confidence-adjuster', 'process-feedback',
            'generate-learning-context', 'all monitor-* functions'
          ],
          how_to_use: 'Automation runs continuously in background. Configure sources and keywords, set escalation rules, enable notifications. System handles rest automatically. Monitor performance via automation_metrics and system health tools.'
        }
      };
      
      const explanation = featureExplanations[featureName];
      if (!explanation) {
        return { 
          success: false,
          error: `Feature "${featureName}" not found. Available features: signals, incidents, entities, travel, investigations, monitoring, automation`
        };
      }
      
      return {
        success: true,
        feature: featureName,
        ...explanation,
        message: `Detailed explanation of how the ${featureName} feature works in Fortress`
      };
    }

    case "get_system_architecture": {
      return {
        success: true,
        overview: 'Fortress is a comprehensive security intelligence platform built on React/TypeScript frontend with Supabase (PostgreSQL + Edge Functions) backend. The platform automates OSINT collection, threat detection, incident management, and security operations.',
        frontend: {
          framework: 'React 18.3+ with TypeScript for type safety',
          styling: 'Tailwind CSS with custom design system (index.css, tailwind.config.ts)',
          routing: 'React Router v6 for page navigation',
          state_management: [
            'React Query (TanStack Query) for server state and caching',
            'React hooks (useState, useContext, useReducer) for local state',
            'Custom hooks in src/hooks/ for shared logic'
          ],
          ui_library: 'Shadcn UI components (src/components/ui/) - customizable Radix UI primitives',
          key_pages: [
            'Dashboard (/) - Overview, metrics, AI assistant',
            'Signals (/signals) - Security intelligence feed',
            'Incidents (/incidents) - Incident management',
            'Entities (/entities) - Entity tracking and OSINT',
            'Travel (/travel) - Travel security monitoring',
            'Investigations (/investigations) - Case files',
            'Reports (/reports) - Report generation',
            'Knowledge Base (/knowledge-base) - Documentation',
            'Sources (/sources) - OSINT source configuration',
            'Clients (/clients) - Client management'
          ],
          key_components: [
            'DashboardAIAssistant - AI chat interface',
            'ThreatGlobe - 3D visualization (Three.js, React Three Fiber)',
            'LocationsMap - Mapbox integration',
            'SignalIngestForm - Manual signal creation',
            'EntityUnifiedProfile - Comprehensive entity view',
            'Various dialogs and forms for data management'
          ]
        },
        backend: {
          platform: 'Supabase - PostgreSQL database + Deno edge functions',
          database: {
            engine: 'PostgreSQL 15+ with pgvector extension',
            security: 'Row Level Security (RLS) policies on all tables',
            schema: '40+ tables for signals, incidents, entities, travel, investigations, etc.',
            features: 'Full-text search, JSONB columns, triggers, functions',
            realtime: 'Supabase Realtime for live updates on tables'
          },
          functions: {
            runtime: 'Deno 1.x (JavaScript/TypeScript)',
            deployment: 'Auto-deployed edge functions in supabase/functions/',
            count: '50+ functions for monitoring, processing, AI, alerts',
            examples: [
              'monitor-* functions - Scheduled OSINT scanning',
              'ingest-signal - Process incoming intelligence',
              'ai-decision-engine - AI incident creation',
              'alert-delivery - Multi-channel alerts',
              'osint-entity-scan - Entity research',
              'dashboard-ai-assistant - Conversational AI'
            ]
          },
          storage: {
            provider: 'Supabase Storage',
            buckets: [
              'entity-photos - Photos from OSINT (public)',
              'investigation-files - Case evidence (private)',
              'archival-documents - Historical docs (private)',
              'travel-documents - Itineraries (public)',
              'ai-chat-attachments - AI conversation files (private)'
            ],
            security: 'RLS policies control access per bucket'
          },
          auth: {
            provider: 'Supabase Auth',
            methods: ['Email/password', 'Magic links'],
            roles: 'Custom app_role enum (admin, analyst, viewer) in user_roles table',
            security: 'JWT tokens, RLS enforcement'
          }
        },
        automation: {
          orchestration: 'auto-orchestrator function coordinates all scheduled tasks',
          monitoring: {
            frequency: 'Configurable per source (5min to 24hr intervals)',
            sources: [
              'News RSS feeds',
              'Social media (Twitter, LinkedIn, Facebook, Instagram)',
              'Threat intelligence feeds',
              'Dark web monitoring',
              'GitHub repositories',
              'Pastebin and paste sites',
              'Weather, earthquakes, wildfires',
              'Canadian government sources',
              'Court registries'
            ],
            process: 'Monitor → Extract → Match Keywords → Generate Signals → Store'
          },
          correlation: {
            signal_correlation: 'Groups similar signals using content hashing and NLP',
            entity_correlation: 'Links entities to signals/incidents using NER and keyword matching',
            ai_powered: 'Uses Lovable AI (Gemini models) for advanced pattern detection'
          },
          decision_engine: {
            purpose: 'Automatically creates incidents from correlated signals',
            logic: 'Analyzes severity, entity involvement, correlation confidence, threat patterns',
            triggers: 'High-severity signals, entity proximity, pattern matching',
            output: 'Incident creation with priority, status, linked signals/entities'
          },
          escalation: {
            rules: 'Configurable escalation_rules with conditions and actions',
            checking: 'check-incident-escalation runs every 15 minutes',
            actions: 'Priority increase, status change, alert delivery, assignment',
            sla: 'Tracks acknowledge/contain/resolve times against targets'
          },
          alerts: {
            channels: ['Email (Resend API)', 'Slack webhooks', 'Microsoft Teams webhooks'],
            triggers: 'Incident creation, escalation, entity mentions, travel risks',
            templating: 'React-based email templates with JSX'
          }
        },
        data_flow: {
          ingest: 'OSINT Sources → Monitor Functions → Normalize/Hash → Store Signals → Record History',
          process: 'Signals → Correlation → Entity Detection → Quality Scoring → Deduplication',
          decide: 'Correlated Signals → AI Analysis → Pattern Matching → Incident Creation',
          alert: 'Incidents → Escalation Check → Priority Assessment → Multi-channel Delivery',
          enrich: 'Entities → OSINT Scan → Web Search → Content/Photos Collection → Relationship Detection'
        },
        integrations: {
          ai: {
            provider: 'Lovable AI Gateway',
            models: [
              'google/gemini-2.5-flash (primary - fast, cost-effective)',
              'google/gemini-2.5-pro (complex reasoning)',
              'google/gemini-2.5-flash-lite (classification)',
              'openai/gpt-5-mini (alternative)'
            ],
            uses: [
              'AI decision engine for incidents',
              'Dashboard AI assistant',
              'Investigation writing assistance',
              'Entity enrichment and analysis',
              'Travel risk assessment',
              'Document parsing and entity extraction'
            ]
          },
          maps: 'Mapbox GL JS for location visualization (incidents, entities, travelers)',
          osint_apis: [
            'Google Search API (entity OSINT)',
            'News APIs',
            'Social media APIs (Twitter, Facebook, LinkedIn)',
            'Threat intel feeds',
            'Weather/earthquake APIs'
          ],
          notifications: [
            'Resend API for email delivery',
            'Slack incoming webhooks',
            'Microsoft Teams incoming webhooks'
          ],
          storage: 'Supabase Storage for files, photos, documents with RLS'
        },
        deployment: {
          frontend: 'Lovable hosting (CDN, auto-deployment)',
          backend: 'Supabase cloud (auto-scaling, multi-region)',
          edge_functions: 'Deployed globally on Supabase edge network',
          database: 'Managed PostgreSQL with automatic backups'
        },
        security: {
          authentication: 'Supabase Auth with JWT tokens',
          authorization: 'Row Level Security policies on all tables + custom roles',
          data_encryption: 'At-rest and in-transit encryption',
          api_security: 'API keys in environment variables, CORS configured',
          secrets: 'Supabase secrets management for API keys'
        },
        performance: {
          caching: 'React Query caching for API responses',
          realtime: 'Supabase Realtime for live updates without polling',
          optimization: 'Database indexes on frequently queried columns',
          monitoring: 'automation_metrics table tracks system performance'
        }
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

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Process messages to extract file attachments and format for vision
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        // Look for image URLs in markdown format
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g;
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        
        const imageUrls: string[] = [];
        let match;
        
        // Extract images from markdown/HTML
        while ((match = imageRegex.exec(msg.content)) !== null) {
          const url = match[2] || match[3];
          if (url && (url.includes('ai-chat-attachments') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
            imageUrls.push(url);
          }
        }
        
        // If we have images, format as vision message
        if (imageUrls.length > 0 && msg.role === 'user') {
          const textContent = msg.content.replace(imageRegex, '').replace(markdownLinkRegex, '[$1]').trim();
          const contentParts: any[] = [];
          
          if (textContent) {
            contentParts.push({ type: "text", text: textContent });
          }
          
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
            content: `You are the Fortress AI Assistant - an intelligent security operations assistant with comprehensive knowledge of the platform, its codebase, architecture, and all features.

PLATFORM OVERVIEW:
Fortress is a security intelligence and threat monitoring platform built on React/TypeScript frontend with Supabase (PostgreSQL + Edge Functions) backend. The platform automates OSINT collection, threat detection, incident management, entity tracking, travel security, and investigation management through 50+ edge functions and AI-powered automation.

SYSTEM ARCHITECTURE:
- Frontend: React + TypeScript + Tailwind CSS + Shadcn UI + React Query
- Backend: Supabase PostgreSQL with Row Level Security + 50+ Deno edge functions
- Automation: Auto-orchestrator coordinates monitoring, AI decision engine, escalation, alerts
- AI: Lovable AI (Gemini models) for decision-making, assistance, analysis
- Real-time: Supabase Realtime for live updates on tables
- Storage: Supabase Storage with RLS for files/photos/documents

KEY FEATURES & IMPLEMENTATION:
1. **Signals**: Raw OSINT intelligence → correlation → entity detection → AI incident creation
   - Tables: signals, signal_correlation_groups, entity_mentions
   - Functions: ingest-signal, correlate-signals, correlate-entities, ai-decision-engine

2. **Incidents**: Security events with escalation rules, SLA tracking, multi-channel alerts
   - Tables: incidents, incident_signals, incident_entities, alerts, escalation_rules
   - Functions: ai-decision-engine, check-incident-escalation, alert-delivery

3. **Entities**: Tracked people/orgs/locations with automated OSINT enrichment
   - Tables: entities, entity_mentions, entity_relationships, entity_content, entity_photos
   - Functions: osint-entity-scan, scan-entity-content, scan-entity-photos, enrich-entity

4. **Travel**: Risk assessment and monitoring for personnel in risky locations
   - Tables: travelers, itineraries
   - Functions: parse-travel-itinerary, monitor-travel-risks

5. **Investigations**: Case file management with AI writing assistance
   - Tables: investigations, investigation_entries, investigation_persons, investigation_attachments
   - Functions: investigation-ai-assist, generate-report

6. **Monitoring**: Automated scanning of 20+ OSINT sources (news, social, threat intel, dark web)
   - Tables: sources, monitoring_history, ingested_documents
   - Functions: monitor-news, monitor-social, monitor-threat-intel, monitor-darkweb, etc.

DATABASE SCHEMA:
40+ PostgreSQL tables with RLS policies. Core tables: signals, incidents, entities, clients, investigations, travelers, sources, monitoring_history, automation_metrics. All relationships mapped through foreign keys and junction tables (entity_mentions, incident_signals, etc.).

YOUR CAPABILITIES:
1. **Data Analysis**: Query all database tables for signals, incidents, entities, investigations, travelers, etc.
2. **Codebase Understanding**: Explain feature implementation, data flow, component architecture
3. **System Architecture**: Describe technology stack, edge functions, automation, integrations
4. **Database Schema**: Access table structures, relationships, RLS policies
5. **Edge Functions**: List and explain all 50+ backend functions and their purposes
6. **Issue Detection**: Find duplicate signals, orphaned records, data quality problems
7. **Issue Resolution**: Fix duplicates, clean up data, improve quality
8. **Knowledge Access**: Search documentation in knowledge base
9. **Troubleshooting**: Debug system issues using monitoring status, health metrics, error diagnostics
10. **OSINT Operations**: Trigger entity scans, gather intelligence
11. **Feature Guidance**: Explain how features work and how they're implemented

CRITICAL DISTINCTIONS:
1. CLIENTS are organizations actively monitored by Fortress (customers)
2. ENTITIES are people/organizations mentioned in intelligence data
3. When users ask about a person "of/at [organization]", search for the ENTITY (person), not the client

AVAILABLE PAGES & COMPONENTS:
- Dashboard (/) - Overview with metrics, AI assistant, recent activity
- Signals (/signals) - Signal list, filtering, detail dialogs, entity correlation
- Incidents (/incidents) - Incident management, status updates, SLA tracking
- Entities (/entities) - Entity profiles, relationships, OSINT content, photos
- Travel (/travel) - Traveler list, itineraries, map, risk alerts
- Investigations (/investigations) - Case files, timeline entries, AI assistance
- Reports (/reports) - Report generation, executive summaries
- Knowledge Base (/knowledge-base) - Documentation, articles, guides
- Sources (/sources) - OSINT source management, monitoring config
- Clients (/clients) - Client org management, risk profiles

WHEN USERS ASK ABOUT IMPLEMENTATION OR ARCHITECTURE:
1. Use get_database_schema to show table structures and relationships
2. Use list_edge_functions to explain backend functionality
3. Use explain_feature to describe how specific features work
4. Use get_system_architecture for overall technical design
5. Provide specific code flow examples and data relationships

FILE ATTACHMENTS:
- Analyze attached images for security-relevant information
- Look for threats, suspicious activity, or concerning details in images
- Provide insights on documents and their security implications
- Reference attachments when providing responses

KNOWLEDGE BASE:
When users ask questions about procedures, best practices, or need guidance:
1. Use search_knowledge_base to find relevant articles
2. Reference articles with links: [Article Title](/knowledge-base/{id})
3. Use get_knowledge_base_categories to browse available topics

OSINT SCANNING:
When users want intelligence on a person or organization:
1. Check if entity exists using search_entities
2. Check for existing signals using search_signals_by_entity
3. If no signals, use trigger_osint_scan for comprehensive web search

CODE AND DATA ISSUES:
When users ask about duplicates, data quality, or cleaning:
1. Use analyze_database_issues to scan for problems
2. Use fix_duplicate_signals to merge or remove duplicates
3. Use analyze_signal_quality for metrics and low-confidence signals
4. Always explain changes before modifying/deleting data

TROUBLESHOOTING:
When users report system issues:
1. Use get_monitoring_status to check if scans are running
2. Use get_system_health to view overall performance
3. Use diagnose_issues to identify errors and patterns
4. Provide specific recommendations to fix issues

Be conversational and helpful. Format data clearly with bullet points. Provide navigation links using markdown: [Link Text](/path). When troubleshooting, be specific and actionable. When explaining architecture, be detailed and technical.`,
          },
          ...processedMessages,
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
            content: `You are the Fortress AI Assistant. Summarize tool results in a clear, conversational way. Use markdown links: [Link Text](/path). Be concise and helpful. When file attachments are present, incorporate insights. When explaining architecture or implementation, be detailed and technical.`,
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
            content: `You are the Fortress AI Assistant with comprehensive platform knowledge. Use plain, conversational language. Provide navigation links: [Link Text](/path). When diagnosing issues, be specific and actionable. When file attachments are present, analyze them for security insights. When explaining architecture, be detailed and technical.`,
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