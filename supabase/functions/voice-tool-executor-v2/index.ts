import { createClient } from "npm:@supabase/supabase-js@2";

// Web-safe CORS for browser clients
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ToolArgs = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const tool_name = payload?.tool_name as string | undefined;
    const toolArgs = (payload?.arguments || {}) as ToolArgs;

    if (!tool_name) {
      return new Response(JSON.stringify({ error: "Missing tool_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const assertOk = (op: string, error: any) => {
      if (!error) return;
      console.error(`[Voice Tool v2] ${op} failed:`, error);
      throw new Error(`${op} failed: ${error.message || "Unknown error"}`);
    };

    let result: unknown;

    switch (tool_name) {
      // ----------------------------
      // Memory tools (lightweight stubs)
      // ----------------------------
      case "get_user_memory":
      case "remember_this":
      case "update_user_preferences":
      case "manage_project_context": {
        // Keep voice sessions from hard-failing while we stabilize deployments.
        result = {
          success: false,
          message: "Memory tools temporarily unavailable on voice-tool-executor-v2.",
          tool: tool_name,
        };
        break;
      }

      // ----------------------------
      // Threat radar + threats
      // ----------------------------
      case "get_current_threats": {
        const { data: recentSignals, error: recentSignalsError } = await supabase
          .from("signals")
          .select(
            "id, title, severity, description, source_id, created_at, rule_category, status",
          )
          .in("severity", ["critical", "high"])
          .in("status", ["new", "triaged"])
          .order("created_at", { ascending: false })
          .limit(10);

        assertOk("get_current_threats.signals", recentSignalsError);

        const { data: openIncidents, error: openIncidentsError } = await supabase
          .from("incidents")
          .select(
            "id, title, severity_level, status, incident_type, priority, created_at, opened_at",
          )
          .in("status", ["open", "acknowledged"])
          .order("created_at", { ascending: false })
          .limit(10);

        assertOk("get_current_threats.incidents", openIncidentsError);

        const signalCategories: Record<string, number> = {};
        recentSignals?.forEach((s: any) => {
          const cat = s.rule_category || "Uncategorized";
          signalCategories[cat] = (signalCategories[cat] || 0) + 1;
        });

        result = {
          high_priority_signals:
            recentSignals?.map((s: any) => ({
              id: s.id,
              title: s.title,
              severity: s.severity,
              source: s.source_id,
              category: s.rule_category,
              status: s.status,
              created_at: s.created_at,
            })) || [],
          open_incidents:
            openIncidents?.map((i: any) => ({
              id: i.id,
              title: i.title,
              severity: i.severity_level,
              priority: i.priority,
              type: i.incident_type,
              status: i.status,
              opened_at: i.opened_at,
            })) || [],
          threat_patterns: Object.entries(signalCategories).map(([cat, count]) => ({
            category: cat,
            count,
          })),
          summary: `${recentSignals?.length || 0} high-priority signals, ${openIncidents?.length || 0} open incidents`,
        };
        break;
      }

      case "analyze_threat_radar": {
        const lookbackDays = Number(toolArgs.lookback_days ?? 7);
        const cutoffDate = new Date(
          Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
        ).toISOString();

        const { data: signals, error: signalsError } = await supabase
          .from("signals")
          .select("id, severity, rule_category, created_at")
          .gte("created_at", cutoffDate)
          .order("created_at", { ascending: false })
          .limit(200);

        assertOk("analyze_threat_radar.signals", signalsError);

        const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        const categoryBreakdown: Record<string, number> = {};

        signals?.forEach((s: any) => {
          if (s.severity in severityCounts) {
            severityCounts[s.severity as keyof typeof severityCounts]++;
          }
          const cat = s.rule_category || "Other";
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        });

        const threatScore =
          severityCounts.critical * 10 +
          severityCounts.high * 5 +
          severityCounts.medium * 2 +
          severityCounts.low;

        let overallThreatLevel = "LOW";
        if (threatScore > 50) overallThreatLevel = "CRITICAL";
        else if (threatScore > 30) overallThreatLevel = "HIGH";
        else if (threatScore > 15) overallThreatLevel = "ELEVATED";
        else if (threatScore > 5) overallThreatLevel = "MODERATE";

        result = {
          overall_threat_level: overallThreatLevel,
          threat_score: threatScore,
          signal_breakdown: severityCounts,
          top_categories: Object.entries(categoryBreakdown)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([category, count]) => ({ category, count })),
          analysis_period: `${lookbackDays} days`,
          generated_at: new Date().toISOString(),
        };
        break;
      }

      // ----------------------------
      // Fortress query (simplified)
      // ----------------------------
      case "query_fortress_data": {
        const limit = Number(toolArgs.limit ?? 20);
        const daysBack = Number(toolArgs.time_range_days ?? 30);
        const cutoffDate = new Date(
          Date.now() - daysBack * 24 * 60 * 60 * 1000,
        ).toISOString();

        const results: any = { signals: [], incidents: [], entities: [], documents: [] };

        const { data: signals } = await supabase
          .from("signals")
          .select("id, title, severity, source_id, created_at, rule_category, status")
          .gte("created_at", cutoffDate)
          .order("created_at", { ascending: false })
          .limit(limit);
        results.signals = signals || [];

        const { data: incidents } = await supabase
          .from("incidents")
          .select("id, title, severity_level, status, priority, incident_type, created_at, opened_at")
          .gte("created_at", cutoffDate)
          .order("created_at", { ascending: false })
          .limit(limit);
        results.incidents = incidents || [];

        const { data: entities } = await supabase
          .from("entities")
          .select("id, name, type, risk_level, active_monitoring_enabled")
          .limit(limit);
        results.entities = entities || [];

        const totalCount =
          results.signals.length + results.incidents.length + results.entities.length;

        result = {
          found: totalCount > 0,
          time_range_days: daysBack,
          total_count: totalCount,
          ...results,
          summary: `Found ${results.signals.length} signals, ${results.incidents.length} incidents, ${results.entities.length} entities`,
        };
        break;
      }

      // ----------------------------
      // Fallback
      // ----------------------------
      default:
        result = {
          error: `Unknown tool: ${tool_name}`,
          available_tools: [
            "search_web",
            "get_current_threats",
            "get_entity_info",
            "query_legal_database",
            "query_fortress_data",
            "generate_intelligence_summary",
            "analyze_threat_radar",
            "get_user_memory",
            "remember_this",
            "update_user_preferences",
            "manage_project_context",
          ],
        };
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Voice Tool v2] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
