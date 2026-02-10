// ═══════════════════════════════════════════════════════════════════════════════
//    AEGIS TOOL HANDLERS — Signals, Incidents & Data Quality
// ═══════════════════════════════════════════════════════════════════════════════
import type { ToolHandlerRegistry } from "./aegis-tool-executor.ts";

// Helper — reused across handlers for edge function calls with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  }
}

export const signalsAndIncidentsHandlers: ToolHandlerRegistry = {

  get_signal_incident_status: async (args, supabaseClient) => {
    const signalId = args.signal_id;
    const { data: signal, error: signalError } = await supabaseClient
      .from("signals")
      .select("id, normalized_text, severity, raw_json, status")
      .eq("id", signalId)
      .single();
    if (signalError || !signal) return { error: `Signal not found: ${signalId}` };

    const { data: directIncident } = await supabaseClient
      .from("incidents")
      .select("id, status, created_at, priority, title")
      .eq("signal_id", signalId)
      .maybeSingle();
    const { data: linkedIncidents } = await supabaseClient
      .from("incident_signals")
      .select("incident_id, incidents(id, status, created_at, priority, title)")
      .eq("signal_id", signalId);

    const hasIncident = !!directIncident || (linkedIncidents && linkedIncidents.length > 0);
    const incident = directIncident || linkedIncidents?.[0]?.incidents;
    const aiDecision = signal.raw_json?.ai_decision;
    const shouldCreateIncident = aiDecision?.should_create_incident;

    return {
      signal_id: signalId,
      has_incident: hasIncident,
      incident_id: incident?.id || null,
      incident_status: incident?.status || null,
      incident_title: incident?.title || null,
      auto_created: hasIncident && shouldCreateIncident === true,
      ai_recommendation: {
        should_create_incident: shouldCreateIncident,
        threat_level: aiDecision?.threat_level,
        incident_priority: aiDecision?.incident_priority,
        reasoning: aiDecision?.reasoning,
      },
      signal_status: signal.status,
      message: hasIncident
        ? `Incident ${incident?.id} already exists for this signal (status: ${incident?.status})`
        : shouldCreateIncident
          ? "AI recommended incident creation but no incident was created - this may indicate an error"
          : "No incident exists and AI did not recommend creating one",
    };
  },

  get_recent_signals: async (args, supabaseClient) => {
    let query = supabaseClient
      .from("signals")
      .select("id, title, description, severity, received_at, created_at, event_date, status, client_id, clients(name)")
      .order("received_at", { ascending: false })
      .limit(args.limit || 10);

    if (args.client_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(args.client_id)) {
        query = query.eq("client_id", args.client_id);
      } else {
        const { data: client, error: clientError } = await supabaseClient
          .from("clients")
          .select("id")
          .ilike("name", `%${args.client_id}%`)
          .limit(1)
          .single();
        if (clientError || !client) return { message: `No client found matching "${args.client_id}"`, signals: [] };
        query = query.eq("client_id", client.id);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const now = new Date();
    const enrichedSignals = (data || []).map((signal: any) => {
      const eventDate = signal.event_date ? new Date(signal.event_date) : null;
      let ageCategory = "current";
      let ageDescription = "";

      if (eventDate) {
        const ageDays = Math.floor((now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
        if (ageDays <= 7) {
          ageCategory = "current";
          ageDescription = ageDays === 0 ? "Today" : ageDays === 1 ? "Yesterday" : `${ageDays} days ago`;
        } else if (ageDays <= 30) {
          ageCategory = "recent";
          ageDescription = `${Math.ceil(ageDays / 7)} weeks ago`;
        } else if (ageDays <= 365) {
          ageCategory = "dated";
          ageDescription = `${Math.floor(ageDays / 30)} months ago`;
        } else {
          ageCategory = "historical";
          const years = Math.floor(ageDays / 365);
          ageDescription = years === 1 ? "1 year ago" : `${years} years ago`;
        }
      }

      return {
        ...signal,
        temporal_context: {
          event_date: signal.event_date,
          ingested_at: signal.received_at || signal.created_at,
          age_category: ageCategory,
          age_description: ageDescription,
          is_historical: ageCategory === "historical" || ageCategory === "dated",
          warning:
            ageCategory === "historical"
              ? `⚠️ HISTORICAL: This event occurred ${ageDescription}. Do NOT present as current threat.`
              : ageCategory === "dated"
                ? `📜 DATED: This event occurred ${ageDescription}. Provide temporal context when reporting.`
                : null,
        },
      };
    });

    return enrichedSignals;
  },

  get_active_incidents: async (args, supabaseClient) => {
    const now = new Date();
    const currentDateISO = now.toISOString();

    let query = supabaseClient
      .from("incidents")
      .select("id, title, summary, status, priority, severity_level, opened_at, updated_at, client_id, clients(name)")
      .in("status", ["open", "acknowledged", "contained"])
      .order("updated_at", { ascending: false });

    if (args.hours_back) {
      const cutoffISO = new Date(now.getTime() - args.hours_back * 60 * 60 * 1000).toISOString();
      if (args.include_stale === false) {
        query = query.or(`opened_at.gte.${cutoffISO},updated_at.gte.${cutoffISO}`);
      } else {
        query = query.gte("updated_at", cutoffISO);
      }
    }
    if (args.priority) query = query.eq("priority", args.priority);
    if (args.client_id) query = query.eq("client_id", args.client_id);

    const { data, error } = await query.limit(args.limit || 10);
    if (error) throw error;

    const incidentsWithAge = (data || []).map((incident: any) => {
      const openedAt = new Date(incident.opened_at);
      const updatedAt = new Date(incident.updated_at);
      const ageMs = now.getTime() - openedAt.getTime();
      const ageHours = Math.round(ageMs / (1000 * 60 * 60));
      const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
      const staleDays = Math.round((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));

      return {
        ...incident,
        age_hours: ageHours,
        age_days: ageDays,
        age_display: ageDays > 1 ? `${ageDays} days ago` : ageHours > 1 ? `${ageHours} hours ago` : "Recent",
        stale_days: staleDays,
        is_stale: staleDays > 7,
        opened_date_formatted: openedAt.toISOString().split("T")[0],
        updated_date_formatted: updatedAt.toISOString().split("T")[0],
      };
    });

    return {
      current_date: currentDateISO.split("T")[0],
      current_datetime: currentDateISO,
      total_found: incidentsWithAge.length,
      time_filter_applied: args.hours_back ? `Last ${args.hours_back} hours` : "None",
      incidents: incidentsWithAge,
      summary: {
        p1_count: incidentsWithAge.filter((i: any) => i.priority === "p1").length,
        p2_count: incidentsWithAge.filter((i: any) => i.priority === "p2").length,
        stale_count: incidentsWithAge.filter((i: any) => i.is_stale).length,
        recent_24h_count: incidentsWithAge.filter((i: any) => i.age_hours <= 24).length,
      },
      note: incidentsWithAge.some((i: any) => i.is_stale)
        ? "⚠️ Some incidents are stale (not updated in 7+ days). Consider reviewing or closing them."
        : null,
    };
  },

  search_entities: async (args, supabaseClient) => {
    const { data, error } = await supabaseClient
      .from("entities")
      .select("id, name, type, description, risk_level, threat_score, current_location")
      .ilike("name", `%${args.query}%`)
      .limit(args.limit || 10);
    if (error) throw error;
    return data;
  },

  search_investigations: async (args, supabaseClient) => {
    const { data, error } = await supabaseClient
      .from("investigations")
      .select("id, file_number, synopsis, file_status, created_at, client_id, clients(name)")
      .or(`file_number.ilike.%${args.query}%,synopsis.ilike.%${args.query}%`)
      .limit(args.limit || 10);
    if (error) throw error;
    return data;
  },

  search_clients: async (args, supabaseClient) => {
    const { data, error } = await supabaseClient
      .from("clients")
      .select("id, name, industry, status, locations")
      .ilike("name", `%${args.query}%`)
      .limit(10);
    if (error) throw error;
    return data;
  },

  search_agents: async (args, supabaseClient) => {
    const q = (args.query || "").toString().trim();
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 10;
    const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const { data, error } = await supabaseClient
      .from("ai_agents")
      .select("id, header_name, codename, call_sign, is_active, is_client_facing, updated_at")
      .or(`header_name.ilike.%${escaped}%,codename.ilike.%${escaped}%,call_sign.ilike.%${escaped}%`)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  search_signals_by_entity: async (args, supabaseClient) => {
    const { data: entities, error: entityError } = await supabaseClient
      .from("entities")
      .select("id, name, type, description")
      .ilike("name", `%${args.entity_name}%`)
      .limit(5);

    if (entityError) throw new Error(`Failed to search entities: ${entityError.message}`);
    if (!entities || entities.length === 0) {
      return {
        success: false,
        message: `No entity found matching "${args.entity_name}". You may need to create this entity first in the [Entities](/entities) page.`,
        signals: [],
      };
    }

    const entityIds = entities.map((e: any) => e.id);
    const { data: mentions, error: mentionsError } = await supabaseClient
      .from("entity_mentions")
      .select("signal_id, entity_id, confidence, context")
      .in("entity_id", entityIds)
      .order("detected_at", { ascending: false })
      .limit(args.limit || 20);

    if (mentionsError) throw new Error(`Failed to search entity mentions: ${mentionsError.message}`);
    if (!mentions || mentions.length === 0) {
      return {
        success: true,
        entities,
        message: `Found entity "${entities[0].name}" (${entities[0].type}) but no intelligence signals mention this entity yet.`,
        signals: [],
        suggestion: `Try: "Perform an OSINT scan on ${entities[0].name}" to gather intelligence from the web.`,
      };
    }

    const signalIds = [...new Set(mentions.map((m: any) => m.signal_id))];
    const { data: signals, error: signalsError } = await supabaseClient
      .from("signals")
      .select("id, title, description, severity, received_at, status, category, client_id, clients(name)")
      .in("id", signalIds)
      .order("received_at", { ascending: false });

    if (signalsError) throw new Error(`Failed to fetch signals: ${signalsError.message}`);
    return {
      success: true,
      entities,
      entity_mentions_count: mentions.length,
      signals: signals || [],
      message: `Found ${signals?.length || 0} signal(s) mentioning ${entities[0].name}`,
    };
  },

  get_monitoring_status: async (args, supabaseClient) => {
    const hours = args.hours || 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseClient
      .from("monitoring_history")
      .select("*")
      .gte("scan_started_at", cutoff)
      .order("scan_started_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const bySource = data.reduce((acc: any, scan: any) => {
      if (!acc[scan.source_name]) acc[scan.source_name] = { total: 0, completed: 0, failed: 0, running: 0 };
      acc[scan.source_name].total++;
      if (scan.status === "completed") acc[scan.source_name].completed++;
      if (scan.status === "failed") acc[scan.source_name].failed++;
      if (scan.status === "running") acc[scan.source_name].running++;
      return acc;
    }, {});

    return { summary: bySource, total_scans: data.length, recent_scans: data.slice(0, 10) };
  },

  get_wildfire_intelligence: async (args, _supabaseClient) => {
    const { client_id, region = "world", include_fuel_data = true } = args;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/monitor-wildfire-comprehensive`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ client_id, region, include_fuel_data }),
        },
        30000,
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Wildfire monitoring failed: ${errorText}`,
          fallback_info: {
            data_sources: { NASA_FIRMS: "https://firms.modaps.eosdis.nasa.gov/api/area/", NWS_Alerts: "https://api.weather.gov/alerts/active" },
            manual_check: "Visit https://firms.modaps.eosdis.nasa.gov/map/ for live fire map",
          },
        };
      }

      const wildfireData = await response.json();
      return {
        success: true,
        risk_assessment: wildfireData.risk_assessment,
        data_sources: wildfireData.data_sources,
        signals_created: wildfireData.signals_created,
        clients_scanned: wildfireData.clients_scanned,
        source_descriptions: wildfireData.source_descriptions,
        summary: `Wildfire Intelligence Report: Risk Level ${wildfireData.risk_assessment?.riskLevel || "Unknown"} (${wildfireData.risk_assessment?.riskScore || 0}/100). Data from ${Object.keys(wildfireData.data_sources || {}).length} sources. ${wildfireData.signals_created || 0} signals generated.`,
        recommendations:
          wildfireData.risk_assessment?.riskLevel === "Extreme" || wildfireData.risk_assessment?.riskLevel === "High"
            ? ["Monitor evacuation orders", "Review business continuity plans", "Check air quality impacts", "Assess supply chain disruptions"]
            : ["Continue routine monitoring", "No immediate action required"],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error fetching wildfire data",
        fallback_info: { manual_resources: ["https://firms.modaps.eosdis.nasa.gov/map/", "https://www.nifc.gov/fireInfo/nfn.htm"] },
      };
    }
  },

  get_system_health: async (args, supabaseClient) => {
    const days = args.days || 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: metrics, error: metricsError } = await supabaseClient
      .from("automation_metrics").select("*").gte("metric_date", cutoff).order("metric_date", { ascending: false });
    if (metricsError) throw metricsError;

    const { data: activeIncidents, error: incidentsError } = await supabaseClient
      .from("incidents").select("id, status, priority").in("status", ["open", "investigating"]).limit(100);
    if (incidentsError) throw incidentsError;

    const { data: recentSignals, error: signalsError } = await supabaseClient
      .from("signals").select("id, created_at, status").gte("created_at", cutoff).limit(1000);
    if (signalsError) throw signalsError;

    const totals = metrics.reduce(
      (acc: any, m: any) => {
        acc.signals_processed += m.signals_processed || 0;
        acc.incidents_created += m.incidents_created || 0;
        acc.osint_scans += m.osint_scans_completed || 0;
        acc.alerts_sent += m.alerts_sent || 0;
        return acc;
      },
      { signals_processed: 0, incidents_created: 0, osint_scans: 0, alerts_sent: 0 },
    );

    return {
      metrics: totals,
      active_incidents_count: activeIncidents.length,
      signals_last_7_days: recentSignals.length,
      average_scans_per_day: Math.round(totals.osint_scans / days),
      latest_metrics: metrics[0],
    };
  },

  diagnose_issues: async (args, supabaseClient) => {
    const limit = args.limit || 20;
    const { data: failedScans, error: scanError } = await supabaseClient
      .from("monitoring_history").select("*").eq("status", "failed").order("scan_started_at", { ascending: false }).limit(limit);
    if (scanError) throw scanError;

    const { data: errorSources, error: sourceError } = await supabaseClient
      .from("sources").select("name, status, error_message, last_ingested_at").not("error_message", "is", null).limit(20);
    if (sourceError) throw sourceError;

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
  },

  trigger_osint_scan: async (args, supabaseClient) => {
    const { data: entity, error: findError } = await supabaseClient
      .from("entities").select("id, name, type").ilike("name", `%${args.entity_name}%`).limit(1).single();

    if (findError) {
      if (findError.code === "PGRST116") {
        return { success: false, message: `Entity "${args.entity_name}" not found. Create it first, then perform the OSINT scan.` };
      }
      throw new Error(`Failed to lookup entity: ${findError.message}`);
    }
    if (!entity) return { success: false, message: `Entity "${args.entity_name}" not found.` };

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    console.log(`Triggering OSINT scan for entity: ${entity.name} (${entity.id})`);

    try {
      const scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/osint-web-search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: entity.id }),
      });

      if (!scanResponse.ok) {
        const errorText = await scanResponse.text();
        if (errorText.includes("Google Search API not configured") || errorText.includes("GOOGLE_SEARCH")) {
          return { success: false, message: "OSINT scanning requires Google Search API configuration.", entity: entity.name, error_type: "configuration" };
        }
        if (scanResponse.status === 404) {
          return { success: false, message: "The OSINT scan service is not available.", entity: entity.name, error_type: "service_unavailable" };
        }
        return { success: false, message: `OSINT scan failed for ${entity.name}. Status: ${scanResponse.status}. Details: ${errorText.substring(0, 200)}`, error_type: "scan_failed" };
      }

      const result = await scanResponse.json();
      return {
        success: true,
        message: `✅ OSINT scan completed for ${entity.name}! ${result.content_created || 0} items created, ${result.signals_created || 0} signals generated.`,
        entity: entity.name,
        content_created: result.content_created || 0,
        signals_created: result.signals_created || 0,
      };
    } catch (fetchError) {
      return {
        success: false,
        message: `Failed to connect to OSINT scan service for ${entity.name}. Error: ${fetchError instanceof Error ? fetchError.message : "Network error"}`,
        error_type: "network_error",
      };
    }
  },

  analyze_database_issues: async (args, supabaseClient) => {
    const issueType = args.issue_type || "all";
    const issues: any = { duplicate_signals: [], orphaned_records: [], data_quality: [] };

    if (issueType === "duplicates" || issueType === "all") {
      const { data: duplicates } = await supabaseClient
        .from("signals").select("content_hash, id, title, created_at, confidence").not("content_hash", "is", null).order("created_at", { ascending: false }).limit(500);
      if (duplicates) {
        const hashMap = new Map();
        duplicates.forEach((signal: any) => {
          if (!hashMap.has(signal.content_hash)) hashMap.set(signal.content_hash, []);
          hashMap.get(signal.content_hash).push(signal);
        });
        hashMap.forEach((signals, hash) => {
          if (signals.length > 1) {
            issues.duplicate_signals.push({ hash, count: signals.length, signals: signals.map((s: any) => ({ id: s.id, title: s.title, created_at: s.created_at, confidence: s.confidence })) });
          }
        });
      }
    }

    if (issueType === "orphaned_records" || issueType === "all") {
      const { data: orphanedMentions } = await supabaseClient
        .from("entity_mentions").select("id, entity_id, signal_id, incident_id").is("signal_id", null).is("incident_id", null).limit(100);
      if (orphanedMentions && orphanedMentions.length > 0) {
        issues.orphaned_records.push({ type: "entity_mentions", count: orphanedMentions.length, details: "Entity mentions with no signal or incident reference", sample_ids: orphanedMentions.slice(0, 5).map((m: any) => m.id) });
      }
    }

    if (issueType === "data_quality" || issueType === "all") {
      const { data: lowQuality } = await supabaseClient
        .from("signals").select("id, title, confidence, status, created_at").lt("confidence", 0.3).eq("status", "new").order("created_at", { ascending: false }).limit(50);
      if (lowQuality && lowQuality.length > 0) {
        issues.data_quality.push({ type: "low_confidence_signals", count: lowQuality.length, signals: lowQuality.slice(0, 10) });
      }

      const { data: incomplete } = await supabaseClient
        .from("signals").select("id, title, description, category").or("description.is.null,category.is.null").order("created_at", { ascending: false }).limit(20);
      if (incomplete && incomplete.length > 0) {
        issues.data_quality.push({ type: "incomplete_signals", count: incomplete.length, details: "Signals missing description or category" });
      }
    }

    return {
      success: true,
      issues,
      summary: `Found ${issues.duplicate_signals.length} duplicate groups (${issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0)} total duplicates), ${issues.orphaned_records.reduce((sum: number, r: any) => sum + r.count, 0)} orphaned records, ${issues.data_quality.reduce((sum: number, q: any) => sum + q.count, 0)} data quality issues`,
      total_duplicate_signals: issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0),
    };
  },
};
