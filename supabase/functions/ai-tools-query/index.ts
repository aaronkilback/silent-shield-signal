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

      case "get_entity_summary_for_signal":
        const { signal_id: sigId } = parameters;
        if (!sigId) {
          return new Response(JSON.stringify({ error: 'signal_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: signalData, error: sigError } = await supabase
          .from('signals')
          .select('id, correlated_entity_ids')
          .eq('id', sigId)
          .single();

        if (sigError || !signalData) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const entityIds = signalData.correlated_entity_ids || [];
        if (entityIds.length === 0) {
          result = { entities: [] };
          break;
        }

        const { data: entityDetails } = await supabase
          .from('entities')
          .select('*')
          .in('id', entityIds);

        result = {
          entities: entityDetails?.map(e => ({
            id: e.id,
            name: e.name,
            type: e.type,
            description: e.description,
            risk_level: e.risk_level,
            threat_score: e.threat_score,
            last_activity: e.updated_at,
            key_attributes: e.attributes,
          })) || []
        };
        break;

      case "get_related_signals":
        const { signal_id: relSigId, criteria = 'shared_entities' } = parameters;
        if (!relSigId) {
          return new Response(JSON.stringify({ error: 'signal_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: sourceSignal, error: srcError } = await supabase
          .from('signals')
          .select('id, correlated_entity_ids, normalized_text, category')
          .eq('id', relSigId)
          .single();

        if (srcError || !sourceSignal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        let relatedQuery = supabase
          .from('signals')
          .select('id, normalized_text, category, severity, created_at, correlated_entity_ids')
          .neq('id', relSigId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (criteria === 'shared_entities' && sourceSignal.correlated_entity_ids?.length > 0) {
          relatedQuery = relatedQuery.overlaps('correlated_entity_ids', sourceSignal.correlated_entity_ids);
        } else if (criteria === 'same_category' && sourceSignal.category) {
          relatedQuery = relatedQuery.eq('category', sourceSignal.category);
        }

        const { data: relatedSignals } = await relatedQuery;
        result = {
          related_signals: relatedSignals || [],
          criteria,
          source_signal_id: relSigId
        };
        break;

      case "get_source_reputation":
        const { source_id: srcId } = parameters;
        if (!srcId) {
          return new Response(JSON.stringify({ error: 'source_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: sourceData, error: sourceErr } = await supabase
          .from('sources')
          .select('id, name, type, status, created_at')
          .eq('id', srcId)
          .single();

        if (sourceErr || !sourceData) {
          return new Response(JSON.stringify({ error: 'Source not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: metrics } = await supabase
          .from('source_reliability_metrics')
          .select('*')
          .eq('source_id', srcId)
          .single();

        const { count: signalCount } = await supabase
          .from('signals')
          .select('id', { count: 'exact', head: true })
          .contains('sources_mentioned', [sourceData.name]);

        result = {
          reputation: {
            source_id: srcId,
            source_name: sourceData.name,
            source_type: sourceData.type,
            status: sourceData.status,
            total_signals: signalCount || 0,
            reliability_score: metrics?.reliability_score || 0.5,
            accurate_signals: metrics?.accurate_signals || 0,
            false_positives: metrics?.false_positives || 0,
            last_updated: metrics?.last_updated || sourceData.created_at,
          }
        };
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
