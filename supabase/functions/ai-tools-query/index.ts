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
          .in("status", ["open", "acknowledged", "contained"])
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

      case "get_client_risk_profile":
        const { client_id: clientId } = parameters;
        if (!clientId) {
          return new Response(JSON.stringify({ error: 'client_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: clientProfile, error: clientProfileError } = await supabase
          .from('clients')
          .select('id, name, industry, risk_assessment, threat_profile, high_value_assets, locations, monitoring_keywords, employee_count, status')
          .eq('id', clientId)
          .single();
        
        if (clientProfileError || !clientProfile) {
          return new Response(JSON.stringify({ error: 'Client not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        result = clientProfile;
        break;

      case "get_client_critical_assets":
        const { client_id: assetClientId } = parameters;
        if (!assetClientId) {
          return new Response(JSON.stringify({ error: 'client_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: clientAssets, error: clientAssetsError } = await supabase
          .from('clients')
          .select('id, name, high_value_assets, locations, risk_assessment')
          .eq('id', assetClientId)
          .single();
        
        if (clientAssetsError || !clientAssets) {
          return new Response(JSON.stringify({ error: 'Client not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const assetRegistry = (clientAssets?.high_value_assets || []).map((asset: string, index: number) => ({
          asset_name: asset,
          criticality: 'high',
          asset_type: 'infrastructure',
          index: index + 1
        }));
        
        result = {
          client_id: clientAssets?.id,
          client_name: clientAssets?.name,
          critical_assets: assetRegistry,
          locations: clientAssets?.locations || [],
          risk_assessment: clientAssets?.risk_assessment
        };
        break;

      case "get_client_operational_context":
        const { client_id: opsClientId } = parameters;
        if (!opsClientId) {
          return new Response(JSON.stringify({ error: 'client_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: clientOps, error: clientOpsError } = await supabase
          .from('clients')
          .select('id, name, industry, locations, monitoring_config, threat_profile, risk_assessment, employee_count, competitor_names, supply_chain_entities')
          .eq('id', opsClientId)
          .single();
        
        if (clientOpsError || !clientOps) {
          return new Response(JSON.stringify({ error: 'Client not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        result = clientOps;
        break;

      case "update_risk_profile":
        const { entity_id: entityId, risk_score, justifications } = parameters;
        if (!entityId || risk_score === undefined) {
          return new Response(JSON.stringify({ error: 'entity_id and risk_score required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: entityUpdate, error: entityUpdateError } = await supabase
          .from('entities')
          .update({
            threat_score: risk_score,
            risk_level: risk_score >= 80 ? 'critical' : 
                       risk_score >= 60 ? 'high' :
                       risk_score >= 40 ? 'medium' : 'low',
            updated_at: new Date().toISOString(),
          })
          .eq('id', entityId)
          .select()
          .single();

        if (entityUpdateError) {
          return new Response(JSON.stringify({ error: entityUpdateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        result = {
          success: true,
          entity_id: entityId,
          updated_risk_score: risk_score,
          justifications,
          timestamp: new Date().toISOString(),
        };
        break;

      case "recommend_playbook":
        const { signal_id: playbookSigId, client_context } = parameters;
        if (!playbookSigId) {
          return new Response(JSON.stringify({ error: 'signal_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: playbookSignal, error: playbookSigError } = await supabase
          .from('signals')
          .select('id, category, severity, normalized_text, client_id, clients(industry)')
          .eq('id', playbookSigId)
          .single();

        if (playbookSigError || !playbookSignal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: allPlaybooks } = await supabase
          .from('playbooks')
          .select('*');

        const clientIndustry = Array.isArray(playbookSignal.clients) 
          ? playbookSignal.clients[0]?.industry 
          : (playbookSignal.clients as any)?.industry;

        const relevantPlaybooks = (allPlaybooks || []).filter((playbook: any) => {
          const keyLower = playbook.key.toLowerCase();
          const categoryLower = (playbookSignal.category || '').toLowerCase();
          const textLower = (playbookSignal.normalized_text || '').toLowerCase();
          
          return keyLower.includes(categoryLower) || 
                 textLower.includes(keyLower) ||
                 playbook.markdown.toLowerCase().includes(categoryLower);
        });

        result = {
          signal_id: playbookSigId,
          recommended_playbooks: relevantPlaybooks.map((p: any) => ({
            id: p.id,
            key: p.key,
            title: p.title,
            relevance_score: 0.8,
          })),
          client_industry: clientIndustry,
        };
        break;

      case "draft_response_tasks":
        const { playbook_id, signal_id: taskSigId } = parameters;
        if (!playbook_id || !taskSigId) {
          return new Response(JSON.stringify({ error: 'playbook_id and signal_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: playbook, error: playbookError } = await supabase
          .from('playbooks')
          .select('*')
          .eq('id', playbook_id)
          .single();

        if (playbookError || !playbook) {
          return new Response(JSON.stringify({ error: 'Playbook not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: taskSignal, error: taskSigError } = await supabase
          .from('signals')
          .select('*')
          .eq('id', taskSigId)
          .single();

        if (taskSigError || !taskSignal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tasks = generateResponseTasks(playbook, taskSignal);
        
        result = {
          playbook_id,
          signal_id: taskSigId,
          tasks,
          estimated_completion_time: tasks.length * 30,
        };
        break;

      case "integrate_incident_management":
        const { signal_id: incidentSigId, task_list, incident_priority } = parameters;
        if (!incidentSigId || !task_list) {
          return new Response(JSON.stringify({ error: 'signal_id and task_list required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: incidentSignal, error: incidentSigError } = await supabase
          .from('signals')
          .select('*')
          .eq('id', incidentSigId)
          .single();

        if (incidentSigError || !incidentSignal) {
          return new Response(JSON.stringify({ error: 'Signal not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: existingIncident } = await supabase
          .from('incidents')
          .select('id')
          .eq('signal_id', incidentSigId)
          .single();

        if (existingIncident) {
          const { data: updatedIncident, error: updateError } = await supabase
            .from('incidents')
            .update({
              priority: incident_priority || 'p3',
              timeline_json: task_list,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingIncident.id)
            .select()
            .single();

          result = {
            action: 'updated',
            incident_id: existingIncident.id,
            tasks: task_list,
          };
        } else {
          const { data: newIncident, error: createError } = await supabase
            .from('incidents')
            .insert({
              signal_id: incidentSigId,
              client_id: incidentSignal.client_id,
              title: incidentSignal.title || 'Auto-generated incident',
              summary: incidentSignal.description,
              priority: incident_priority || 'p3',
              status: 'open',
              timeline_json: task_list,
              severity_level: incidentSignal.severity,
            })
            .select()
            .single();

          if (createError) {
            return new Response(JSON.stringify({ error: createError.message }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          result = {
            action: 'created',
            incident_id: newIncident.id,
            tasks: task_list,
          };
        }
        break;

      case "query_fortress_data":
        // Comprehensive fortress data query tool
        const { 
          query_type: fortressQueryType = 'comprehensive',
          filters: fortressFilters = {},
          output_format: fortressOutputFormat = 'detailed',
          reason_for_access: fortressReason,
          agent_id: fortressAgentId
        } = parameters;

        if (!fortressReason) {
          return new Response(JSON.stringify({ error: 'reason_for_access is required for audit purposes' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Log access for audit
        await supabase.from('intelligence_config').upsert({
          key: `fortress_data_access_${Date.now()}`,
          value: {
            query_type: fortressQueryType,
            filters: fortressFilters,
            reason: fortressReason,
            agent_id: fortressAgentId,
            timestamp: new Date().toISOString()
          },
          description: 'Fortress data access audit log'
        });

        const fortressLimit = fortressFilters.limit || 100;
        const fortressResults: Record<string, any> = {};

        // Helper function for common filters
        const applyFortressFilters = (query: any) => {
          if (fortressFilters.client_id) {
            query = query.eq('client_id', fortressFilters.client_id);
          }
          if (fortressFilters.time_range?.start) {
            query = query.gte('created_at', fortressFilters.time_range.start);
          }
          if (fortressFilters.time_range?.end) {
            query = query.lte('created_at', fortressFilters.time_range.end);
          }
          return query.limit(fortressLimit);
        };

        // Query signals
        if (fortressQueryType === 'signals' || fortressQueryType === 'comprehensive') {
          let signalsQ = supabase.from('signals').select('*');
          signalsQ = applyFortressFilters(signalsQ);
          if (fortressFilters.severity?.length) signalsQ = signalsQ.in('severity', fortressFilters.severity);
          if (fortressFilters.status?.length) signalsQ = signalsQ.in('status', fortressFilters.status);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `normalized_text.ilike.%${k}%`).join(',');
            signalsQ = signalsQ.or(kf);
          }
          const { data: sigData } = await signalsQ.order('created_at', { ascending: false });
          fortressResults.signals = sigData;
        }

        // Query incidents
        if (fortressQueryType === 'incidents' || fortressQueryType === 'comprehensive') {
          let incQ = supabase.from('incidents').select('*, signals(*)');
          incQ = applyFortressFilters(incQ);
          if (fortressFilters.priority?.length) incQ = incQ.in('priority', fortressFilters.priority);
          if (fortressFilters.status?.length) incQ = incQ.in('status', fortressFilters.status);
          const { data: incData } = await incQ.order('created_at', { ascending: false });
          fortressResults.incidents = incData;
        }

        // Query entities
        if (fortressQueryType === 'entities' || fortressQueryType === 'comprehensive') {
          let entQ = supabase.from('entities').select('*, entity_relationships(*), entity_mentions(*)');
          if (fortressFilters.client_id) entQ = entQ.eq('client_id', fortressFilters.client_id);
          if (fortressFilters.entity_id) entQ = entQ.eq('id', fortressFilters.entity_id);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `name.ilike.%${k}%,description.ilike.%${k}%`).join(',');
            entQ = entQ.or(kf);
          }
          const { data: entData } = await entQ.limit(fortressLimit).order('updated_at', { ascending: false });
          fortressResults.entities = entData;
        }

        // Query clients
        if (fortressQueryType === 'clients' || fortressQueryType === 'comprehensive') {
          let clientQ = supabase.from('clients').select('*');
          if (fortressFilters.client_id) clientQ = clientQ.eq('id', fortressFilters.client_id);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `name.ilike.%${k}%,industry.ilike.%${k}%`).join(',');
            clientQ = clientQ.or(kf);
          }
          const { data: clientData } = await clientQ.limit(fortressLimit);
          fortressResults.clients = clientData;
        }

        // Query documents
        if (fortressQueryType === 'documents' || fortressQueryType === 'comprehensive') {
          let docQ = supabase.from('archival_documents').select('*');
          docQ = applyFortressFilters(docQ);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `content_text.ilike.%${k}%,summary.ilike.%${k}%,filename.ilike.%${k}%`).join(',');
            docQ = docQ.or(kf);
          }
          const { data: docData } = await docQ.order('created_at', { ascending: false });
          fortressResults.documents = docData;
        }

        // Query investigations
        if (fortressQueryType === 'investigations' || fortressQueryType === 'comprehensive') {
          let invQ = supabase.from('investigations').select('*, investigation_entries(*), investigation_persons(*)');
          invQ = applyFortressFilters(invQ);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `synopsis.ilike.%${k}%,information.ilike.%${k}%,recommendations.ilike.%${k}%`).join(',');
            invQ = invQ.or(kf);
          }
          const { data: invData } = await invQ.order('created_at', { ascending: false });
          fortressResults.investigations = invData;
        }

        // Query knowledge base
        if (fortressQueryType === 'knowledge_base' || fortressQueryType === 'comprehensive') {
          let kbQ = supabase.from('knowledge_base_articles').select('*, knowledge_base_categories(*)');
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `title.ilike.%${k}%,content.ilike.%${k}%,summary.ilike.%${k}%`).join(',');
            kbQ = kbQ.or(kf);
          }
          const { data: kbData } = await kbQ.limit(fortressLimit).order('updated_at', { ascending: false });
          fortressResults.knowledge_base = kbData;
        }

        // Query monitoring history
        if (fortressQueryType === 'monitoring_history' || fortressQueryType === 'comprehensive') {
          let monQ = supabase.from('monitoring_history').select('*');
          if (fortressFilters.time_range?.start) monQ = monQ.gte('scan_started_at', fortressFilters.time_range.start);
          if (fortressFilters.time_range?.end) monQ = monQ.lte('scan_started_at', fortressFilters.time_range.end);
          if (fortressFilters.status?.length) monQ = monQ.in('status', fortressFilters.status);
          const { data: monData } = await monQ.limit(fortressLimit).order('scan_started_at', { ascending: false });
          fortressResults.monitoring_history = monData;
        }

        // Query travel
        if (fortressQueryType === 'travel' || fortressQueryType === 'comprehensive') {
          let travelQ = supabase.from('itineraries').select('*, travelers(*)');
          travelQ = applyFortressFilters(travelQ);
          if (fortressFilters.keywords?.length) {
            const kf = fortressFilters.keywords.map((k: string) => `destination_country.ilike.%${k}%,destination_city.ilike.%${k}%,trip_name.ilike.%${k}%`).join(',');
            travelQ = travelQ.or(kf);
          }
          const { data: travelData } = await travelQ.order('departure_date', { ascending: false });
          fortressResults.travel = travelData;
        }

        // Format output
        if (fortressOutputFormat === 'summary') {
          result = {
            query_type: fortressQueryType,
            timestamp: new Date().toISOString(),
            summary: {
              signals_count: fortressResults.signals?.length || 0,
              incidents_count: fortressResults.incidents?.length || 0,
              entities_count: fortressResults.entities?.length || 0,
              clients_count: fortressResults.clients?.length || 0,
              documents_count: fortressResults.documents?.length || 0,
              investigations_count: fortressResults.investigations?.length || 0,
              knowledge_base_count: fortressResults.knowledge_base?.length || 0,
              monitoring_history_count: fortressResults.monitoring_history?.length || 0,
              travel_count: fortressResults.travel?.length || 0,
            },
            filters_applied: fortressFilters,
            data: fortressResults
          };
        } else {
          result = {
            query_type: fortressQueryType,
            timestamp: new Date().toISOString(),
            reason_for_access: fortressReason,
            agent_id: fortressAgentId,
            filters_applied: fortressFilters,
            data: fortressResults,
            metadata: {
              total_records: Object.values(fortressResults).reduce((acc: number, arr: any) => acc + (arr?.length || 0), 0),
              query_types_included: Object.keys(fortressResults).filter(k => fortressResults[k]?.length > 0)
            }
          };
        }
        break;

      default:
        result = { error: "Unknown tool" };
    }

    function generateResponseTasks(playbook: any, signal: any): any[] {
      const tasks = [];
      const severity = signal.severity?.toLowerCase() || 'medium';
      
      tasks.push({
        task_id: 1,
        action: "Initial Assessment",
        description: `Review signal details and assess immediate threat level`,
        assigned_to: "Security Operations Center",
        priority: severity === 'critical' ? 'immediate' : 'high',
        estimated_minutes: 15,
      });

      if (severity === 'critical' || severity === 'high') {
        tasks.push({
          task_id: 2,
          action: "Escalate to Leadership",
          description: `Notify senior security leadership and relevant stakeholders`,
          assigned_to: "Security Manager",
          priority: 'immediate',
          estimated_minutes: 10,
        });
      }

      tasks.push({
        task_id: 3,
        action: "Containment Measures",
        description: `Implement immediate containment based on ${playbook.title}`,
        assigned_to: "Response Team",
        priority: 'high',
        estimated_minutes: 45,
      });

      tasks.push({
        task_id: 4,
        action: "Investigation",
        description: `Conduct thorough investigation following playbook procedures`,
        assigned_to: "Investigation Team",
        priority: 'medium',
        estimated_minutes: 120,
      });

      tasks.push({
        task_id: 5,
        action: "Documentation",
        description: `Document all findings, actions taken, and lessons learned`,
        assigned_to: "Security Analyst",
        priority: 'medium',
        estimated_minutes: 30,
      });

      return tasks;
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
