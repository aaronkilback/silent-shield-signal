import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeVoiceMemoryTool } from "../_shared/voice-memory-tools.ts";
import {
  handleAnalyzeThreatRadar,
  handleGetClientInfo,
  handleGetKnowledgeBase,
  handleGetTravelStatus,
  handleGetInvestigationStatus,
  handleCheckDarkWebExposure,
  handleGetThreatIntelFeeds,
  handleRunVipDeepScan,
  handleRunEntityDeepScan,
  searchInternalOnly,
} from "../_shared/voice-tool-handlers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tool_name, arguments: toolArgs } = await req.json();
    
    console.log(`[Voice Tool] Executing: ${tool_name}`, toolArgs);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const assertQueryOk = (op: string, error: any) => {
      if (!error) return;
      console.error(`[Voice Tool] ${op} failed:`, error);
      throw new Error(`${op} failed: ${error.message || 'Unknown error'}`);
    };

    let result: unknown;

    // Memory tools are implemented separately
    const memoryHandled = await executeVoiceMemoryTool({
      req,
      supabase,
      toolName: tool_name,
      toolArgs: toolArgs || {},
    });

    if (memoryHandled.handled) {
      result = memoryHandled.result;
    } else switch (tool_name) {
      case 'search_web': {
        const query = toolArgs.query || '';
        const geographic_focus = toolArgs.geographic_focus || '';
        
        try {
          const searchResponse = await fetch(`${supabaseUrl}/functions/v1/perform-external-web-search`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              query,
              geographic_focus,
              max_results: 5,
            }),
          });
          
          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const summaryParts: string[] = [];
            
            if (searchData.source_urls && searchData.source_urls.length > 0) {
              summaryParts.push(`Found ${searchData.source_urls.length} web sources:`);
              searchData.source_urls.slice(0, 3).forEach((source: any) => {
                const dateInfo = source.published_date ? ` (${source.published_date})` : '';
                const warning = source.date_warning ? ` ${source.date_warning}` : '';
                summaryParts.push(`- ${source.title}${dateInfo}${warning}: ${source.snippet?.substring(0, 150)}...`);
              });
            }
            
            if (searchData.key_entities && searchData.key_entities.length > 0) {
              summaryParts.push(`\nRelated entities in Fortress: ${searchData.key_entities.slice(0, 5).join(', ')}`);
            }
            
            if (searchData.key_dates && searchData.key_dates.length > 0) {
              summaryParts.push(`\nRecent signals: ${searchData.key_dates.slice(0, 3).join('; ')}`);
            }
            
            result = {
              found: searchData.data_source !== 'no_data',
              summary: searchData.summary,
              details: summaryParts.join('\n'),
              source_type: searchData.data_source,
              reliability_note: searchData.reliability_note,
              query: query
            };
          } else {
            result = await searchInternalOnly(supabase, query, geographic_focus);
          }
        } catch (error) {
          console.error('[Voice Tool] Search error:', error);
          result = await searchInternalOnly(supabase, query, geographic_focus);
        }
        break;
      }
      
      case 'get_current_threats': {
        const { data: recentSignals, error: recentSignalsError } = await supabase
          .from('signals')
          .select('id, title, severity, description, source_id, created_at, rule_category, status')
          .in('severity', ['critical', 'high'])
          .in('status', ['new', 'triaged'])
          .order('created_at', { ascending: false })
          .limit(10);

        assertQueryOk('get_current_threats.signals', recentSignalsError);
        
        const { data: openIncidents, error: openIncidentsError } = await supabase
          .from('incidents')
          .select('id, title, severity_level, status, incident_type, priority, created_at, opened_at')
          .in('status', ['open', 'acknowledged'])
          .order('created_at', { ascending: false })
          .limit(10);

        assertQueryOk('get_current_threats.incidents', openIncidentsError);
        
        const signalCategories: Record<string, number> = {};
        recentSignals?.forEach((s: any) => {
          const cat = s.rule_category || 'Uncategorized';
          signalCategories[cat] = (signalCategories[cat] || 0) + 1;
        });
        
        result = {
          high_priority_signals: recentSignals?.map((s: any) => ({
            id: s.id,
            title: s.title,
            severity: s.severity,
            source: s.source_id,
            category: s.rule_category,
            status: s.status,
            created_at: s.created_at
          })) || [],
          open_incidents: openIncidents?.map((i: any) => ({
            id: i.id,
            title: i.title,
            severity: i.severity_level,
            priority: i.priority,
            type: i.incident_type,
            status: i.status,
            opened_at: i.opened_at
          })) || [],
          threat_patterns: Object.entries(signalCategories).map(([cat, count]) => ({ category: cat, count })),
          summary: `${recentSignals?.length || 0} high-priority signals, ${openIncidents?.length || 0} open incidents`
        };
        break;
      }
      
      case 'get_entity_info': {
        const entityName = toolArgs.entity_name || '';
        
        const { data: entities, error: entitiesError } = await supabase
          .from('entities')
          .select('*')
          .ilike('name', `%${entityName}%`)
          .limit(5);

        assertQueryOk('get_entity_info.entities', entitiesError);
        
        if (entities && entities.length > 0) {
          const entity = entities[0];
          
          const { data: relatedSignals } = await supabase
            .from('signals')
            .select('id, title, severity, created_at, rule_category, status')
            .contains('auto_correlated_entities', [entity.id])
            .order('created_at', { ascending: false })
            .limit(5);
          
          let relatedIncidents: any[] = [];
          if (relatedSignals && relatedSignals.length > 0) {
            const signalIds = relatedSignals.map((s: any) => s.id);
            const { data: incidentsBySignal } = await supabase
              .from('incidents')
              .select('id, title, severity_level, status, priority, signal_id, opened_at')
              .in('signal_id', signalIds)
              .order('opened_at', { ascending: false })
              .limit(5);
            relatedIncidents = incidentsBySignal || [];
          }
          
          result = {
            found: true,
            entity: {
              id: entity.id,
              name: entity.name,
              type: entity.type,
              risk_level: entity.risk_level,
              monitoring_status: entity.active_monitoring_enabled ? 'enabled' : 'disabled',
              aliases: entity.aliases,
              description: entity.description,
              attributes: entity.attributes
            },
            recent_signals: relatedSignals || [],
            recent_incidents: relatedIncidents || [],
            other_matches: entities.length > 1 ? entities.slice(1).map((e: any) => e.name) : []
          };
        } else {
          result = {
            found: false,
            message: `No entity found matching "${entityName}"`
          };
        }
        break;
      }
      
      case 'query_legal_database': {
        const jurisdiction = toolArgs.jurisdiction || 'Canada';
        const topic = toolArgs.topic || toolArgs.query || '';
        
        try {
          const legalResponse = await fetch(`${supabaseUrl}/functions/v1/query-legal-database`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              jurisdiction,
              topic,
              keywords: toolArgs.keywords || [],
              include_case_law: true,
              include_statutes: true,
              max_results: 5,
            }),
          });
          
          if (legalResponse.ok) {
            const legalData = await legalResponse.json();
            result = {
              found: legalData.success,
              results: legalData.results,
              disclaimer: legalData.disclaimer,
              query: { jurisdiction, topic }
            };
          } else {
            result = {
              found: false,
              message: 'Legal database query failed.',
              query: { jurisdiction, topic }
            };
          }
        } catch (error) {
          result = {
            found: false,
            message: 'Unable to query legal database at this time.',
            query: { jurisdiction, topic }
          };
        }
        break;
      }
      
      case 'query_fortress_data': {
        const queryType = toolArgs.query_type || 'comprehensive';
        const keywords = toolArgs.keywords || [];
        const limit = toolArgs.limit || 20;
        const daysBack = toolArgs.time_range_days || 30;
        const severityFilter = toolArgs.severity_filter || 'all';
        const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
        
        const results: any = { signals: [], incidents: [], entities: [], documents: [] };
        
        if (queryType === 'signals' || queryType === 'comprehensive') {
          let query = supabase
            .from('signals')
            .select('id, title, severity, source_id, created_at, rule_category, status, description')
            .gte('created_at', cutoffDate)
            .order('created_at', { ascending: false })
            .limit(limit);
          
          if (severityFilter !== 'all') {
            query = query.eq('severity', severityFilter);
          }
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `title.ilike.%${k}%,description.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.signals = data || [];
        }
        
        if (queryType === 'incidents' || queryType === 'comprehensive') {
          let query = supabase
            .from('incidents')
            .select('id, title, severity_level, status, priority, incident_type, created_at, opened_at, summary')
            .gte('created_at', cutoffDate)
            .order('created_at', { ascending: false })
            .limit(limit);
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `title.ilike.%${k}%,summary.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.incidents = data || [];
        }
        
        if (queryType === 'entities' || queryType === 'comprehensive') {
          let query = supabase
            .from('entities')
            .select('id, name, type, risk_level, active_monitoring_enabled, aliases, description')
            .limit(limit);
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `name.ilike.%${k}%,description.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.entities = (data || []).map((e: any) => ({
            ...e,
            entity_type: e.type,
            monitoring_status: e.active_monitoring_enabled ? 'enabled' : 'disabled',
          }));
        }
        
        if (queryType === 'documents' || queryType === 'comprehensive') {
          let query = supabase
            .from('archival_documents')
            .select('id, filename, summary, tags, keywords, created_at')
            .gte('created_at', cutoffDate)
            .order('created_at', { ascending: false })
            .limit(limit);
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `filename.ilike.%${k}%,summary.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.documents = data || [];
        }
        
        const totalCount = results.signals.length + results.incidents.length + results.entities.length + results.documents.length;
        
        result = {
          found: totalCount > 0,
          query_type: queryType,
          time_range_days: daysBack,
          total_count: totalCount,
          ...results,
          summary: `Found ${results.signals.length} signals, ${results.incidents.length} incidents, ${results.entities.length} entities, ${results.documents.length} documents`
        };
        break;
      }
      
      case 'generate_intelligence_summary': {
        const timeRangeHours = toolArgs.time_range_hours || 24;
        const cutoffDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString();
        
        const { data: signals } = await supabase
          .from('signals')
          .select('id, title, severity, source_id, created_at, rule_category, status')
          .gte('created_at', cutoffDate)
          .order('created_at', { ascending: false })
          .limit(50);
        
        const criticalSignals = signals?.filter((s: any) => ['critical', 'high'].includes(s.severity)) || [];
        
        const { data: incidents } = await supabase
          .from('incidents')
          .select('id, title, severity_level, status, priority, incident_type, opened_at')
          .in('status', ['open', 'acknowledged'])
          .order('opened_at', { ascending: false })
          .limit(20);
        
        const highPriorityIncidents = incidents?.filter((i: any) => ['p1', 'p2'].includes(i.priority)) || [];
        
        const { data: highRiskEntities } = await supabase
          .from('entities')
          .select('id, name, type, risk_level')
          .in('risk_level', ['critical', 'high'])
          .limit(10);
        
        const categoryMap: Record<string, number> = {};
        signals?.forEach((s: any) => {
          const cat = s.rule_category || 'Uncategorized';
          categoryMap[cat] = (categoryMap[cat] || 0) + 1;
        });
        
        const threatPatterns = Object.entries(categoryMap)
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        
        result = {
          time_range_hours: timeRangeHours,
          generated_at: new Date().toISOString(),
          summary: {
            total_signals: signals?.length || 0,
            critical_high_signals: criticalSignals.length,
            total_open_incidents: incidents?.length || 0,
            high_priority_incidents: highPriorityIncidents.length,
            high_risk_entities: highRiskEntities?.length || 0
          },
          critical_signals: criticalSignals.slice(0, 5).map((s: any) => ({
            title: s.title,
            severity: s.severity,
            source: s.source_id,
            category: s.rule_category,
            time: s.created_at
          })),
          high_priority_incidents: highPriorityIncidents.slice(0, 5).map((i: any) => ({
            title: i.title,
            priority: i.priority,
            severity: i.severity_level,
            type: i.incident_type,
            status: i.status
          })),
          threat_patterns: threatPatterns,
          high_risk_entities: highRiskEntities?.slice(0, 5).map((e: any) => ({
            name: e.name,
            type: e.type,
            risk_level: e.risk_level
          })) || [],
          briefing_note: `Intelligence summary for the past ${timeRangeHours} hours.`
        };
        break;
      }
      
      case 'analyze_threat_radar':
        result = await handleAnalyzeThreatRadar(supabase, toolArgs);
        break;
      
      case 'get_client_info':
        result = await handleGetClientInfo(supabase, toolArgs);
        break;
      
      case 'get_knowledge_base':
        result = await handleGetKnowledgeBase(supabase, toolArgs);
        break;
      
      case 'get_travel_status':
        result = await handleGetTravelStatus(supabase);
        break;
      
      case 'get_investigation_status':
        result = await handleGetInvestigationStatus(supabase, toolArgs);
        break;
      
      case 'check_dark_web_exposure':
        result = await handleCheckDarkWebExposure(toolArgs);
        break;
      
      case 'get_threat_intel_feeds':
        result = await handleGetThreatIntelFeeds();
        break;
      
      case 'run_vip_deep_scan':
        result = await handleRunVipDeepScan(supabaseUrl, supabaseKey, toolArgs);
        break;
      
      case 'run_entity_deep_scan':
        result = await handleRunEntityDeepScan(supabase, supabaseUrl, supabaseKey, toolArgs);
        break;
      
      default:
        result = { error: `Unknown tool: ${tool_name}`, available_tools: [
          'search_web', 'get_current_threats', 'get_entity_info', 'query_legal_database',
          'query_fortress_data', 'generate_intelligence_summary', 'analyze_threat_radar',
          'get_client_info', 'get_knowledge_base', 'get_travel_status', 'get_investigation_status',
          'get_user_memory', 'remember_this', 'update_user_preferences', 'manage_project_context',
          'check_dark_web_exposure', 'run_vip_deep_scan', 'get_threat_intel_feeds', 'run_entity_deep_scan'
        ]};
    }
    
    console.log(`[Voice Tool] Result for ${tool_name}:`, JSON.stringify(result).substring(0, 500));
    
    return new Response(
      JSON.stringify({ result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[Voice Tool] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
