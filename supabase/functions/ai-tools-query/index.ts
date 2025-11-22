import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { toolName, parameters } = await req.json();
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let result;

    switch (toolName) {
      case "get_recent_signals":
        const { data: signals } = await supabase
          .from("signals")
          .select("id, title, description, severity, confidence, received_at, status, client_id, clients(name)")
          .order("received_at", { ascending: false })
          .limit(parameters?.limit || 10);
        result = signals;
        break;

      case "get_active_incidents":
        const { data: incidents } = await supabase
          .from("incidents")
          .select("id, title, priority, status, severity_level, opened_at, client_id, clients(name)")
          .in("status", ["open", "investigating", "contained"])
          .order("opened_at", { ascending: false })
          .limit(parameters?.limit || 10);
        result = incidents;
        break;

      case "search_entities":
        const searchQuery = parameters?.query || "";
        const { data: entities } = await supabase
          .from("entities")
          .select("id, name, type, risk_level, threat_score, current_location, threat_indicators")
          .or(`name.ilike.%${searchQuery}%,aliases.cs.{${searchQuery}}`)
          .limit(parameters?.limit || 10);
        result = entities;
        break;

      case "get_entity_details":
        const { data: entity } = await supabase
          .from("entities")
          .select(`
            *,
            entity_mentions(count),
            entity_content(count)
          `)
          .eq("id", parameters?.entityId)
          .single();
        result = entity;
        break;

      case "get_monitoring_stats":
        const { data: stats } = await supabase
          .from("automation_metrics")
          .select("*")
          .order("metric_date", { ascending: false })
          .limit(7);
        result = stats;
        break;

      case "trigger_manual_scan":
        const { data: scanResult } = await supabase.functions.invoke("manual-scan-trigger", {
          body: { sourceName: parameters?.source || "news" },
        });
        result = { success: true, message: "Scan triggered", data: scanResult };
        break;

      case "get_client_risk_summary":
        const { data: clients } = await supabase
          .from("clients")
          .select(`
            id,
            name,
            industry,
            risk_assessment,
            monitoring_config,
            signals(count),
            incidents(count)
          `)
          .limit(parameters?.limit || 5);
        result = clients;
        break;

      case "search_investigations":
        const invQuery = parameters?.query || "";
        const { data: investigations } = await supabase
          .from("investigations")
          .select("id, file_number, synopsis, file_status, created_at, client_id, clients(name)")
          .or(`file_number.ilike.%${invQuery}%,synopsis.ilike.%${invQuery}%`)
          .order("created_at", { ascending: false })
          .limit(parameters?.limit || 10);
        result = investigations;
        break;

      case "search_knowledge_base":
        const kbQuery = parameters?.query || "";
        const { data: articles } = await supabase
          .from("knowledge_base_articles")
          .select("id, title, summary, category_id, tags, created_at, view_count")
          .eq("is_published", true)
          .or(`title.ilike.%${kbQuery}%,content.ilike.%${kbQuery}%,tags.cs.{${kbQuery}}`)
          .order("created_at", { ascending: false })
          .limit(parameters?.limit || 10);
        result = articles;
        break;

      case "search_clients":
        const clientQuery = parameters?.query || "";
        const { data: clientResults } = await supabase
          .from("clients")
          .select("id, name, industry, status, contact_email, locations, signals(count), incidents(count)")
          .or(`name.ilike.%${clientQuery}%,industry.ilike.%${clientQuery}%`)
          .order("name", { ascending: true })
          .limit(parameters?.limit || 10);
        result = clientResults;
        break;

      case "search_signals":
        const sigQuery = parameters?.query || "";
        const { data: signalResults } = await supabase
          .from("signals")
          .select("id, title, description, severity, confidence, received_at, status, source, client_id, clients(name)")
          .or(`title.ilike.%${sigQuery}%,description.ilike.%${sigQuery}%`)
          .order("received_at", { ascending: false })
          .limit(parameters?.limit || 10);
        result = signalResults;
        break;

      default:
        result = { error: "Unknown tool" };
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ai-tools-query:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
