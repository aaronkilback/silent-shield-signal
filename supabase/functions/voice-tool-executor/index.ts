import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tool_name, arguments: toolArgs } = await req.json();
    
    console.log(`[Voice Tool] Executing: ${tool_name}`, toolArgs);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let result: unknown;

    switch (tool_name) {
      case 'search_web': {
        // Use the perform-external-web-search function which supports real Google Search
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
            console.log('[Voice Tool] External search failed, falling back to internal search');
            result = await searchInternalOnly(supabase, query, geographic_focus);
          }
        } catch (error) {
          console.error('[Voice Tool] Search error:', error);
          result = await searchInternalOnly(supabase, query, geographic_focus);
        }
        break;
      }
      
      case 'get_current_threats': {
        // Get recent high-priority signals and incidents
        const { data: recentSignals } = await supabase
          .from('signals')
          .select('id, title, severity, description, source, created_at, rule_category, status')
          .in('severity', ['critical', 'high'])
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(10);
        
        const { data: openIncidents } = await supabase
          .from('incidents')
          .select('id, title, severity_level, status, incident_type, priority, created_at, opened_at')
          .in('status', ['open', 'investigating'])
          .order('created_at', { ascending: false })
          .limit(10);
        
        // Get threat patterns
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
            source: s.source,
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
        
        const { data: entities } = await supabase
          .from('entities')
          .select('*')
          .ilike('name', `%${entityName}%`)
          .limit(5);
        
        if (entities && entities.length > 0) {
          const entity = entities[0];
          
          // Get related signals
          const { data: relatedSignals } = await supabase
            .from('signals')
            .select('id, title, severity, created_at, rule_category')
            .contains('correlated_entity_ids', [entity.id])
            .order('created_at', { ascending: false })
            .limit(5);
          
          // Get related incidents
          const { data: relatedIncidents } = await supabase
            .from('incidents')
            .select('id, title, severity_level, status, priority')
            .contains('correlated_entity_ids', [entity.id])
            .order('created_at', { ascending: false })
            .limit(3);
          
          result = {
            found: true,
            entity: {
              id: entity.id,
              name: entity.name,
              type: entity.entity_type,
              risk_level: entity.risk_level,
              monitoring_status: entity.monitoring_status,
              aliases: entity.aliases,
              description: entity.description,
              notes: entity.notes
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
              message: 'Legal database query failed. Please try a more specific query.',
              query: { jurisdiction, topic }
            };
          }
        } catch (error) {
          console.error('[Voice Tool] Legal query error:', error);
          result = {
            found: false,
            message: 'Unable to query legal database at this time.',
            query: { jurisdiction, topic }
          };
        }
        break;
      }
      
      case 'query_fortress_data': {
        // Search Fortress database for signals, incidents, entities, or documents
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
            .select('id, title, severity, source, created_at, rule_category, status, description')
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
            .select('id, title, severity_level, status, priority, incident_type, created_at, description')
            .gte('created_at', cutoffDate)
            .order('created_at', { ascending: false })
            .limit(limit);
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `title.ilike.%${k}%,description.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.incidents = data || [];
        }
        
        if (queryType === 'entities' || queryType === 'comprehensive') {
          let query = supabase
            .from('entities')
            .select('id, name, entity_type, risk_level, monitoring_status, aliases, description')
            .limit(limit);
          
          if (keywords.length > 0) {
            const searchTerms = keywords.map((k: string) => `name.ilike.%${k}%,description.ilike.%${k}%`).join(',');
            query = query.or(searchTerms);
          }
          
          const { data } = await query;
          results.entities = data || [];
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
        // Generate a formal intelligence briefing
        const timeRangeHours = toolArgs.time_range_hours || 24;
        const cutoffDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString();
        
        // Get recent signals
        const { data: signals } = await supabase
          .from('signals')
          .select('id, title, severity, source, created_at, rule_category, status')
          .gte('created_at', cutoffDate)
          .order('created_at', { ascending: false })
          .limit(50);
        
        // Get critical/high signals
        const criticalSignals = signals?.filter((s: any) => ['critical', 'high'].includes(s.severity)) || [];
        
        // Get open incidents
        const { data: incidents } = await supabase
          .from('incidents')
          .select('id, title, severity_level, status, priority, incident_type, opened_at')
          .in('status', ['open', 'investigating'])
          .order('opened_at', { ascending: false })
          .limit(20);
        
        const highPriorityIncidents = incidents?.filter((i: any) => ['p1', 'p2'].includes(i.priority)) || [];
        
        // Get high-risk entities
        const { data: highRiskEntities } = await supabase
          .from('entities')
          .select('id, name, entity_type, risk_level, monitoring_status')
          .in('risk_level', ['critical', 'high'])
          .limit(10);
        
        // Compute threat patterns
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
            source: s.source,
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
            type: e.entity_type,
            risk_level: e.risk_level
          })) || [],
          briefing_note: `Intelligence summary for the past ${timeRangeHours} hours. All data sourced from Fortress database.`
        };
        break;
      }
      
      case 'analyze_threat_radar': {
        // Get threat radar analysis with predictions
        const clientId = toolArgs.client_id;
        
        // Get recent signals by severity
        const { data: allSignals } = await supabase
          .from('signals')
          .select('id, severity, rule_category, created_at')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(100);
        
        const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        const categoryBreakdown: Record<string, number> = {};
        
        allSignals?.forEach((s: any) => {
          if (s.severity in severityCounts) {
            severityCounts[s.severity as keyof typeof severityCounts]++;
          }
          const cat = s.rule_category || 'Other';
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        });
        
        // Get active incidents
        const { data: activeIncidents } = await supabase
          .from('incidents')
          .select('id, priority, status')
          .in('status', ['open', 'investigating']);
        
        const incidentCounts = { p1: 0, p2: 0, p3: 0, p4: 0 };
        activeIncidents?.forEach((i: any) => {
          if (i.priority in incidentCounts) {
            incidentCounts[i.priority as keyof typeof incidentCounts]++;
          }
        });
        
        // Calculate overall threat level
        const threatScore = (severityCounts.critical * 10) + (severityCounts.high * 5) + (severityCounts.medium * 2) + (severityCounts.low * 1);
        let overallThreatLevel = 'LOW';
        if (threatScore > 50) overallThreatLevel = 'CRITICAL';
        else if (threatScore > 30) overallThreatLevel = 'HIGH';
        else if (threatScore > 15) overallThreatLevel = 'ELEVATED';
        else if (threatScore > 5) overallThreatLevel = 'MODERATE';
        
        result = {
          overall_threat_level: overallThreatLevel,
          threat_score: threatScore,
          signal_breakdown: severityCounts,
          incident_breakdown: incidentCounts,
          top_categories: Object.entries(categoryBreakdown)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([cat, count]) => ({ category: cat, count })),
          analysis_period: '7 days',
          generated_at: new Date().toISOString()
        };
        break;
      }
      
      case 'get_client_info': {
        const clientName = toolArgs.client_name || '';
        
        const { data: clients } = await supabase
          .from('clients')
          .select('id, name, industry, status, locations, monitoring_keywords, contact_email')
          .ilike('name', `%${clientName}%`)
          .limit(5);
        
        if (clients && clients.length > 0) {
          const client = clients[0];
          
          // Get recent signals for this client
          const { data: clientSignals } = await supabase
            .from('signals')
            .select('id, title, severity, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false })
            .limit(5);
          
          // Get open incidents for this client
          const { data: clientIncidents } = await supabase
            .from('incidents')
            .select('id, title, priority, status')
            .eq('client_id', client.id)
            .in('status', ['open', 'investigating'])
            .limit(5);
          
          result = {
            found: true,
            client: {
              id: client.id,
              name: client.name,
              industry: client.industry,
              status: client.status,
              locations: client.locations,
              monitoring_keywords: client.monitoring_keywords
            },
            recent_signals: clientSignals || [],
            open_incidents: clientIncidents || [],
            other_matches: clients.length > 1 ? clients.slice(1).map((c: any) => c.name) : []
          };
        } else {
          result = {
            found: false,
            message: `No client found matching "${clientName}"`
          };
        }
        break;
      }
      
      case 'get_knowledge_base': {
        const topic = toolArgs.topic || toolArgs.query || '';
        const category = toolArgs.category;
        
        let query = supabase
          .from('knowledge_base_articles')
          .select('id, title, content, category, tags, created_at')
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (category) {
          query = query.eq('category', category);
        }
        
        if (topic) {
          query = query.or(`title.ilike.%${topic}%,content.ilike.%${topic}%`);
        }
        
        const { data: articles } = await query;
        
        result = {
          found: (articles?.length || 0) > 0,
          count: articles?.length || 0,
          articles: articles?.map((a: any) => ({
            id: a.id,
            title: a.title,
            category: a.category,
            tags: a.tags,
            excerpt: a.content?.substring(0, 200) + '...'
          })) || [],
          query: { topic, category }
        };
        break;
      }
      
      case 'get_travel_status': {
        // Get current travel itineraries and alerts
        const { data: activeItineraries } = await supabase
          .from('itineraries')
          .select('id, traveler_id, destinations, start_date, end_date, status, risk_level')
          .in('status', ['active', 'upcoming'])
          .order('start_date', { ascending: true })
          .limit(10);
        
        const { data: travelers } = await supabase
          .from('travelers')
          .select('id, name, current_location, status')
          .in('status', ['traveling', 'in_country'])
          .limit(20);
        
        // Get recent travel alerts
        const { data: travelAlerts } = await supabase
          .from('signals')
          .select('id, title, severity, created_at')
          .eq('rule_category', 'Travel Risk')
          .order('created_at', { ascending: false })
          .limit(5);
        
        result = {
          active_travelers: travelers?.length || 0,
          active_itineraries: activeItineraries?.length || 0,
          travelers: travelers?.map((t: any) => ({
            name: t.name,
            location: t.current_location,
            status: t.status
          })) || [],
          itineraries: activeItineraries?.map((i: any) => ({
            destinations: i.destinations,
            start_date: i.start_date,
            end_date: i.end_date,
            risk_level: i.risk_level,
            status: i.status
          })) || [],
          recent_travel_alerts: travelAlerts || []
        };
        break;
      }
      
      case 'get_investigation_status': {
        const investigationName = toolArgs.investigation_name;
        
        let query = supabase
          .from('investigations')
          .select('id, title, status, priority, lead_investigator, created_at, description')
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (investigationName) {
          query = query.ilike('title', `%${investigationName}%`);
        } else {
          query = query.in('status', ['open', 'in_progress']);
        }
        
        const { data: investigations } = await query;
        
        result = {
          found: (investigations?.length || 0) > 0,
          count: investigations?.length || 0,
          investigations: investigations?.map((inv: any) => ({
            id: inv.id,
            title: inv.title,
            status: inv.status,
            priority: inv.priority,
            lead: inv.lead_investigator,
            created_at: inv.created_at,
            description: inv.description?.substring(0, 200)
          })) || []
        };
        break;
      }
      
      default:
        result = { error: `Unknown tool: ${tool_name}`, available_tools: [
          'search_web', 'get_current_threats', 'get_entity_info', 'query_legal_database',
          'query_fortress_data', 'generate_intelligence_summary', 'analyze_threat_radar',
          'get_client_info', 'get_knowledge_base', 'get_travel_status', 'get_investigation_status'
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

// Fallback internal-only search when external search is unavailable
async function searchInternalOnly(supabase: any, query: string, geographic_focus: string) {
  const internalResults: string[] = [];
  
  // Search signals
  const { data: signals } = await supabase
    .from('signals')
    .select('title, description, severity, created_at, event_date, rule_category')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (signals?.length) {
    internalResults.push('**Recent Signals:**');
    signals.forEach((s: any) => {
      const age = s.event_date ? `Event: ${s.event_date}` : `Ingested: ${s.created_at}`;
      internalResults.push(`- [${s.severity?.toUpperCase() || 'MEDIUM'}] ${s.title} (${age})`);
    });
  }
  
  // Search incidents
  const { data: incidents } = await supabase
    .from('incidents')
    .select('title, description, severity_level, status, created_at, priority')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (incidents?.length) {
    internalResults.push('\n**Active Incidents:**');
    incidents.forEach((i: any) => {
      internalResults.push(`- [${i.priority || 'P3'}] ${i.title} - Status: ${i.status}`);
    });
  }
  
  // Search entities
  const { data: entities } = await supabase
    .from('entities')
    .select('name, entity_type, risk_level, monitoring_status')
    .or(`name.ilike.%${query}%,aliases.cs.{${query}}`)
    .limit(5);
  
  if (entities?.length) {
    internalResults.push('\n**Known Entities:**');
    entities.forEach((e: any) => {
      internalResults.push(`- ${e.name} (${e.entity_type}) - Risk: ${e.risk_level || 'Unknown'}`);
    });
  }
  
  // Search knowledge base
  const { data: articles } = await supabase
    .from('knowledge_base_articles')
    .select('title, category')
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .limit(3);
  
  if (articles?.length) {
    internalResults.push('\n**Knowledge Base:**');
    articles.forEach((a: any) => {
      internalResults.push(`- ${a.title} (${a.category})`);
    });
  }
  
  if (internalResults.length > 0) {
    return {
      found: true,
      summary: `Found internal data matching "${query}"`,
      details: internalResults.join('\n'),
      source_type: 'internal_only',
      reliability_note: 'Results from Fortress internal database only. External web search was not available.',
      query: query
    };
  } else {
    return {
      found: false,
      summary: `No information found for "${query}"`,
      details: 'No matching data in Fortress database. External web search was not available for this query.',
      source_type: 'no_data',
      reliability_note: 'No data available. Cannot perform external web search.',
      query: query
    };
  }
}
