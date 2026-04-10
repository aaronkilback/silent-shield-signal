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
    // Batch mode: no signal_id → list recent signals with their incident linkage
    if (!signalId) {
      const limit = args.limit || 10;
      const { data: recentSignals, error: listErr } = await supabaseClient
        .from("signals")
        .select("id, title, severity, status, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (listErr) return { error: listErr.message };
      return { signals: recentSignals, count: recentSignals?.length || 0 };
    }
    const { data: signal, error: signalError } = await supabaseClient
      .from("signals")
      .select("id, normalized_text, severity, raw_json, status")
      .eq("id", signalId)
      .maybeSingle();
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
      .select("id, title, description, severity, received_at, created_at, event_date, status, client_id, source_url, clients(name)")
      .gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("received_at", { ascending: false })
      .limit(args.limit || 50);

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

  get_client_details: async (args, supabaseClient) => {
    const { client_id } = args;
    if (!client_id) return { error: "client_id is required" };
    // Try by UUID first, then by name
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id);
    let query = supabaseClient
      .from("clients")
      .select("id, name, industry, status, locations, monitoring_keywords, monitoring_config, high_value_assets");
    if (isUuid) {
      query = query.eq("id", client_id);
    } else {
      query = query.ilike("name", `%${client_id}%`);
    }
    const { data, error } = await query.limit(1);
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: "Client not found" };
    return { client: data[0] };
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

  get_wildfire_intelligence: async (args, supabaseClient) => {
    const { client_id } = args;

    // Fetch client locations if client_id provided for proximity context
    let clientLocations: string[] = [];
    if (client_id) {
      const { data: client } = await supabaseClient
        .from("clients")
        .select("name, locations")
        .eq("id", client_id)
        .maybeSingle();
      if (client?.locations) {
        clientLocations = Array.isArray(client.locations) ? client.locations : [client.locations];
      }
    }

    // BC Wildfire Service — BC OpenMaps WFS (live government data, no API key required)
    // PROT_CURRENT_FIRE_PNTS_SP = fire points with full attributes (cause, location, lat/lon, etc.)
    const BC_WFS_URL = "https://openmaps.gov.bc.ca/geo/pub/ows";
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP",
      outputFormat: "application/json",
      count: "500",
    });

    let fires: any[] = [];
    let fetchError: string | null = null;

    try {
      const response = await fetchWithTimeout(`${BC_WFS_URL}?${params.toString()}`, {}, 15000);
      if (response.ok) {
        const geojson = await response.json();
        fires = (geojson.features || []).map((f: any) => ({
          fire_number: f.properties.FIRE_NUMBER,
          status: f.properties.FIRE_STATUS,
          size_hectares: f.properties.CURRENT_SIZE ?? f.properties.FIRE_SIZE_HECTARES,
          location: f.properties.GEOGRAPHIC_DESCRIPTION,
          cause: f.properties.FIRE_CAUSE,
          response_type: f.properties.RESPONSE_TYPE_DESC,
          ignition_date: f.properties.IGNITION_DATE,
          fire_centre: f.properties.FIRE_CENTRE,
          lat: f.properties.LATITUDE,
          lon: f.properties.LONGITUDE,
          fire_of_note: f.properties.FIRE_OF_NOTE_IND === "Y",
          fire_url: f.properties.FIRE_URL,
        }));
      } else {
        fetchError = `BC Wildfire API returned HTTP ${response.status}`;
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : "Request failed";
    }

    if (fetchError && fires.length === 0) {
      return {
        success: false,
        error: `Unable to fetch live wildfire data: ${fetchError}`,
        data_source: "BC Wildfire Service — BC OpenMaps WFS",
        manual_check: "https://www2.gov.bc.ca/gov/content/safety/wildfire-status/wildfire-situation",
      };
    }

    const activeFires = fires.filter((f) => f.status !== "Out");
    const outOfControl = activeFires.filter((f) => f.status === "Out of Control");
    const beingHeld = activeFires.filter((f) => f.status === "Being Held");
    const underControl = activeFires.filter((f) => f.status === "Under Control");

    const firesOfNote = activeFires.filter((f) => f.fire_of_note);

    const topBySize = [...activeFires]
      .filter((f) => f.size_hectares != null)
      .sort((a, b) => (b.size_hectares || 0) - (a.size_hectares || 0))
      .slice(0, 10)
      .map((f) => ({
        fire_number: f.fire_number,
        location: f.location,
        status: f.status,
        size_hectares: f.size_hectares,
        cause: f.cause,
        ignition_date: f.ignition_date,
        fire_centre: f.fire_centre,
        fire_of_note: f.fire_of_note,
        fire_url: f.fire_url,
      }));

    const riskScore = Math.min(100, outOfControl.length * 15 + beingHeld.length * 5 + activeFires.length * 1);
    const riskLevel = riskScore >= 70 ? "Extreme" : riskScore >= 40 ? "High" : riskScore >= 15 ? "Moderate" : "Low";

    const byCentre: Record<string, number> = {};
    activeFires.forEach((f) => {
      const centre = f.fire_centre || "Unknown";
      byCentre[centre] = (byCentre[centre] || 0) + 1;
    });

    const humanCaused = activeFires.filter((f) => f.cause === "Human" || f.cause === "Person").length;
    const lightningCaused = activeFires.filter((f) => f.cause === "Lightning").length;

    const recommendations =
      riskLevel === "Extreme" || riskLevel === "High"
        ? [
            "Monitor evacuation orders for BC Interior and Northern BC",
            "Review business continuity plans for field operations",
            "Check air quality advisories for personnel in affected zones",
            "Assess pipeline and infrastructure access route impacts",
          ]
        : activeFires.length > 0
          ? ["Active fires present — continue monitoring", "Check evacuation orders for areas near client operations"]
          : ["No active fires — routine seasonal monitoring only"];

    return {
      success: true,
      as_of: new Date().toISOString(),
      data_source: "BC Wildfire Service — BC OpenMaps WFS (live government data)",
      province: "British Columbia",
      fire_summary: {
        total_active: activeFires.length,
        total_in_database: fires.length,
        out_of_control: outOfControl.length,
        being_held: beingHeld.length,
        under_control: underControl.length,
        out: fires.length - activeFires.length,
      },
      risk_assessment: {
        risk_level: riskLevel,
        risk_score: riskScore,
        primary_driver:
          outOfControl.length > 0
            ? `${outOfControl.length} fire(s) out of control`
            : activeFires.length > 0
              ? `${activeFires.length} active fires`
              : "No active fires",
      },
      cause_breakdown: {
        human_caused: humanCaused,
        lightning_caused: lightningCaused,
        undetermined: activeFires.length - humanCaused - lightningCaused,
      },
      fires_of_note: firesOfNote.map((f) => ({ fire_number: f.fire_number, location: f.location, size_hectares: f.size_hectares, status: f.status, fire_url: f.fire_url })),
      largest_active_fires: topBySize,
      active_fires_by_fire_centre: byCentre,
      recommendations,
      operational_context:
        clientLocations.length > 0
          ? `Client operational areas: ${clientLocations.slice(0, 6).join(", ")}. Cross-reference fire locations above against these areas for proximity risk.`
          : "Provide client_id for proximity context against operational areas.",
    };
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
      const _osintCtrl = new AbortController();
      const _osintTimeout = setTimeout(() => _osintCtrl.abort(), 12000);
      let scanResponse: Response;
      try {
        scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/osint-web-search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ entity_id: entity.id }),
          signal: _osintCtrl.signal,
        });
      } finally {
        clearTimeout(_osintTimeout);
      }

      if (!scanResponse.ok) {
        const errorText = await scanResponse.text();
        if (errorText.includes("Google Search API not configured") || errorText.includes("GOOGLE_SEARCH")) {
          return { success: false, message: "OSINT scanning requires Google Search API configuration.", entity: entity.name, error_type: "configuration" };
        }
        if (scanResponse.status === 404) {
          return { success: true, note: "OSINT scan service not available", entity: entity.name, status: "service_unavailable" };
        }
        return { success: true, note: `OSINT scan failed (${scanResponse.status}) — service may be unavailable`, entity: entity.name };
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
      const isTimeout = fetchError instanceof Error && fetchError.name === "AbortError";
      return {
        success: true,
        note: isTimeout ? "OSINT scan timed out (>12s) — try again later" : `OSINT scan network error: ${fetchError instanceof Error ? fetchError.message : "Network error"}`,
        entity: entity.name,
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

  // ═══ Signal Contradictions ═══
  get_signal_contradictions: async (args, supabaseClient) => {
    const { entity_name, status = 'unresolved', limit = 10 } = args;

    let query = supabaseClient
      .from('signal_contradictions')
      .select('id, entity_name, signal_a_summary, signal_b_summary, contradiction_type, severity, confidence, resolution_status, detected_at')
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (entity_name) {
      query = query.ilike('entity_name', `%${entity_name}%`);
    }
    if (status !== 'all') {
      query = query.eq('resolution_status', status);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };

    return {
      contradictions: data || [],
      count: data?.length || 0,
      summary: data && data.length > 0
        ? `Found ${data.length} ${status} contradictions${entity_name ? ` for "${entity_name}"` : ''}. ${data.filter((c: any) => c.severity === 'high').length} high-severity conflicts.`
        : `No ${status} contradictions found${entity_name ? ` for "${entity_name}"` : ''}.`,
    };
  },

  // ═══ Analyst Accuracy Metrics ═══
  get_analyst_accuracy: async (_args, supabaseClient) => {
    const { data: metrics, error } = await supabaseClient
      .from('analyst_accuracy_metrics')
      .select('user_id, accuracy_score, weight_multiplier, total_feedback, last_calibrated')
      .order('total_feedback', { ascending: false })
      .limit(20);

    if (error) return { error: error.message };

    // Get profile names
    const userIds = (metrics || []).map((m: any) => m.user_id);
    const { data: profiles } = await supabaseClient
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    return {
      analysts: (metrics || []).map((m: any) => ({
        ...m,
        name: profileMap.get(m.user_id)?.full_name || 'Unknown',
        email: profileMap.get(m.user_id)?.email,
      })),
      count: metrics?.length || 0,
      summary: `${metrics?.length || 0} analysts calibrated. Average accuracy: ${metrics && metrics.length > 0 ? Math.round((metrics.reduce((s: number, m: any) => s + m.accuracy_score, 0) / metrics.length) * 100) : 0}%.`,
    };
  },

  // ═══ Monitored Queue (Phase 2C) ═══
  get_monitored_signals: async (args, supabaseClient) => {
    const limit = args.limit || 10;

    // Resolve client_id from name if needed
    let clientId = args.client_id;
    if (clientId && !/^[0-9a-f-]{36}$/.test(clientId)) {
      const { data: client } = await supabaseClient
        .from('clients')
        .select('id')
        .ilike('name', `%${clientId}%`)
        .limit(1)
        .maybeSingle();
      clientId = client?.id || null;
    }

    let query = supabaseClient
      .from('signals')
      .select('id, title, normalized_text, severity, category, composite_confidence, relevance_score, confidence, source_url, created_at, client_id, clients(name)')
      .is('deleted_at', null)
      .not('composite_confidence', 'is', null)
      .gte('composite_confidence', 0.40)
      .lt('composite_confidence', 0.65)
      .order('composite_confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const { data: signals, error } = await query;
    if (error) return { error: error.message };
    if (!signals || signals.length === 0) {
      return {
        monitored_count: 0,
        signals: [],
        summary: 'No signals currently in the monitored queue. Signals appear here when their composite confidence score is between 0.40 and 0.64 \u2014 strong enough to be relevant, not yet strong enough to auto-create an incident.',
      };
    }

    return {
      monitored_count: signals.length,
      threshold_explanation: 'Composite score = (ai_confidence \u00d7 0.50) + (relevance_score \u00d7 0.35) + (source_credibility \u00d7 0.15). Scores 0.40\u20130.64 are watched; \u22650.65 trigger incident creation.',
      signals: signals.map((s: any) => ({
        id: s.id,
        title: s.title || s.normalized_text?.substring(0, 80),
        severity: s.severity,
        category: s.category,
        composite_confidence: s.composite_confidence,
        ai_confidence: s.confidence,
        relevance_score: s.relevance_score,
        client: s.clients?.name,
        source_url: s.source_url,
        created_at: s.created_at,
        gap_to_threshold: Math.round((0.65 - s.composite_confidence) * 100) / 100,
      })),
    };
  },

  // ═══ Knowledge Freshness ═══
  get_knowledge_freshness: async (_args, supabaseClient) => {
    const { data: audits, error } = await supabaseClient
      .from('knowledge_freshness_audits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!audits) return { summary: 'No freshness audits have run yet.' };

    // Get stale knowledge entries
    const { data: stale } = await supabaseClient
      .from('expert_knowledge')
      .select('domain, topic, confidence_score, last_validated_at, created_at')
      .eq('is_active', true)
      .lt('confidence_score', 0.5)
      .order('confidence_score', { ascending: true })
      .limit(10);

    return {
      last_audit: audits,
      stale_entries: stale || [],
      summary: `Last audit: ${audits.audit_date || audits.created_at}. ${stale?.length || 0} knowledge entries below 50% confidence due to decay.`,
    };
  },
};
