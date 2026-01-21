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
          // Call the dedicated web search function
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
            
            // Build a conversational summary from the search results
            const summaryParts: string[] = [];
            
            // External sources
            if (searchData.source_urls && searchData.source_urls.length > 0) {
              summaryParts.push(`Found ${searchData.source_urls.length} web sources:`);
              searchData.source_urls.slice(0, 3).forEach((source: any) => {
                const dateInfo = source.published_date ? ` (${source.published_date})` : '';
                const warning = source.date_warning ? ` ${source.date_warning}` : '';
                summaryParts.push(`- ${source.title}${dateInfo}${warning}: ${source.snippet?.substring(0, 150)}...`);
              });
            }
            
            // Internal data
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
            // Fallback to internal-only search if external search fails
            console.log('[Voice Tool] External search failed, falling back to internal search');
            result = await searchInternalOnly(supabase, query, geographic_focus);
          }
        } catch (error) {
          console.error('[Voice Tool] Search error:', error);
          // Fallback to internal search
          result = await searchInternalOnly(supabase, query, geographic_focus);
        }
        break;
      }
      
      case 'get_current_threats': {
        // Get recent high-priority signals and incidents
        const { data: recentSignals } = await supabase
          .from('signals')
          .select('title, severity, description, created_at')
          .in('severity', ['critical', 'high'])
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(5);
        
        const { data: openIncidents } = await supabase
          .from('incidents')
          .select('title, severity_level, status, created_at')
          .in('status', ['open', 'investigating'])
          .order('created_at', { ascending: false })
          .limit(5);
        
        result = {
          high_priority_signals: recentSignals || [],
          open_incidents: openIncidents || [],
          summary: `${recentSignals?.length || 0} high-priority signals, ${openIncidents?.length || 0} open incidents`
        };
        break;
      }
      
      case 'get_entity_info': {
        const entityName = toolArgs.entity_name || '';
        
        const { data: entity } = await supabase
          .from('entities')
          .select('*')
          .ilike('name', `%${entityName}%`)
          .single();
        
        if (entity) {
          // Get related signals
          const { data: relatedSignals } = await supabase
            .from('signals')
            .select('title, severity, created_at')
            .contains('correlated_entity_ids', [entity.id])
            .order('created_at', { ascending: false })
            .limit(3);
          
          result = {
            found: true,
            entity: {
              name: entity.name,
              type: entity.entity_type,
              risk_level: entity.risk_level,
              monitoring_status: entity.monitoring_status,
              aliases: entity.aliases
            },
            recent_signals: relatedSignals || []
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
        // Call the legal database query function
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
      
      default:
        result = { error: `Unknown tool: ${tool_name}` };
    }
    
    console.log(`[Voice Tool] Result:`, result);
    
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
    .select('title, description, severity, created_at, event_date')
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
    .select('title, description, severity_level, status, created_at')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (incidents?.length) {
    internalResults.push('\n**Active Incidents:**');
    incidents.forEach((i: any) => {
      internalResults.push(`- [${i.severity_level || 'P3'}] ${i.title} - Status: ${i.status}`);
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
