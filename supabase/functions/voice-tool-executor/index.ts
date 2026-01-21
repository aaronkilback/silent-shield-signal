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
        // Use the perform-external-web-search function
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        const query = toolArgs.query || '';
        const geographic_focus = toolArgs.geographic_focus || '';
        
        // First search internal Fortress data
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
          signals.forEach(s => {
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
          incidents.forEach(i => {
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
          entities.forEach(e => {
            internalResults.push(`- ${e.name} (${e.entity_type}) - Risk: ${e.risk_level || 'Unknown'}`);
          });
        }
        
        // Try external search via AI gateway if we have limited internal results
        let externalSummary = '';
        if (LOVABLE_API_KEY && internalResults.length < 3) {
          try {
            const searchPrompt = `Provide a brief, factual summary about: "${query}"${geographic_focus ? ` focusing on ${geographic_focus}` : ''}. 
Keep it to 2-3 sentences. Focus on current, verified information. If you don't have current information, say so.`;
            
            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: 'You are a security intelligence research assistant. Provide brief, factual summaries. Always note if information may be outdated.' },
                  { role: 'user', content: searchPrompt }
                ],
                max_tokens: 200,
              }),
            });
            
            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              externalSummary = aiData.choices?.[0]?.message?.content || '';
            }
          } catch (e) {
            console.error('External search error:', e);
          }
        }
        
        // Compose result
        if (internalResults.length > 0 || externalSummary) {
          result = {
            found: true,
            internal_data: internalResults.join('\n'),
            external_summary: externalSummary,
            query: query
          };
        } else {
          result = {
            found: false,
            message: `No relevant information found for "${query}" in Fortress database or external sources.`,
            query: query
          };
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
