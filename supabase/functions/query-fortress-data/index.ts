import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryRequest {
  query_type: 'signals' | 'incidents' | 'entities' | 'clients' | 'documents' | 'investigations' | 'knowledge_base' | 'monitoring_history' | 'travel' | 'comprehensive';
  filters?: {
    client_id?: string;
    entity_id?: string;
    keywords?: string[];
    severity?: string[];
    priority?: string[];
    status?: string[];
    time_range?: {
      start?: string;
      end?: string;
    };
    limit?: number;
  };
  output_format?: 'summary' | 'detailed' | 'json';
  reason_for_access: string;
  agent_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create client with service role for comprehensive access
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Also create user client for RLS-respecting queries when needed
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const _userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || '' } }
    });

    const request: QueryRequest = await req.json();
    
    // Validate required fields
    if (!request.reason_for_access) {
      return new Response(
        JSON.stringify({ error: "reason_for_access is required for audit purposes" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!request.query_type) {
      return new Response(
        JSON.stringify({ error: "query_type is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the access request for audit
    await supabase.from('intelligence_config').upsert({
      key: `fortress_data_access_${Date.now()}`,
      value: {
        query_type: request.query_type,
        filters: request.filters,
        reason: request.reason_for_access,
        agent_id: request.agent_id,
        timestamp: new Date().toISOString()
      },
      description: 'Fortress data access audit log'
    });

    const filters = request.filters || {};
    const limit = filters.limit || 100;
    const results: Record<string, unknown[]> = {};

    // Helper function to apply common filters
    const applyFilters = (query: ReturnType<typeof supabase.from>) => {
      let q = query;
      if (filters.client_id) {
        q = q.eq('client_id', filters.client_id);
      }
      if (filters.time_range?.start) {
        q = q.gte('created_at', filters.time_range.start);
      }
      if (filters.time_range?.end) {
        q = q.lte('created_at', filters.time_range.end);
      }
      return q.limit(limit);
    };

    // Query based on type
    if (request.query_type === 'signals' || request.query_type === 'comprehensive') {
      let query = supabase.from('signals').select('*');
      query = applyFilters(query);
      
      if (filters.severity?.length) {
        query = query.in('severity', filters.severity);
      }
      if (filters.status?.length) {
        query = query.in('status', filters.status);
      }
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => `normalized_text.ilike.%${k}%`).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      results.signals = data || [];
    }

    if (request.query_type === 'incidents' || request.query_type === 'comprehensive') {
      let query = supabase.from('incidents').select('*, signals(*)');
      query = applyFilters(query);
      
      if (filters.priority?.length) {
        query = query.in('priority', filters.priority);
      }
      if (filters.status?.length) {
        query = query.in('status', filters.status);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      results.incidents = data || [];
    }

    if (request.query_type === 'entities' || request.query_type === 'comprehensive') {
      let query = supabase.from('entities').select('*, entity_relationships(*), entity_mentions(*)');
      
      if (filters.client_id) {
        query = query.eq('client_id', filters.client_id);
      }
      if (filters.entity_id) {
        query = query.eq('id', filters.entity_id);
      }
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => `name.ilike.%${k}%,description.ilike.%${k}%`).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.limit(limit).order('updated_at', { ascending: false });
      if (error) throw error;
      results.entities = data || [];
    }

    if (request.query_type === 'clients' || request.query_type === 'comprehensive') {
      let query = supabase.from('clients').select('*');
      
      if (filters.client_id) {
        query = query.eq('id', filters.client_id);
      }
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => `name.ilike.%${k}%,industry.ilike.%${k}%`).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.limit(limit);
      if (error) throw error;
      results.clients = data || [];
    }

    if (request.query_type === 'documents' || request.query_type === 'comprehensive') {
      let query = supabase.from('archival_documents').select('*');
      query = applyFilters(query);
      
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => 
          `content_text.ilike.%${k}%,summary.ilike.%${k}%,filename.ilike.%${k}%`
        ).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      results.documents = data || [];
    }

    if (request.query_type === 'investigations' || request.query_type === 'comprehensive') {
      let query = supabase.from('investigations').select('*, investigation_entries(*), investigation_persons(*)');
      query = applyFilters(query);
      
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => 
          `synopsis.ilike.%${k}%,information.ilike.%${k}%,recommendations.ilike.%${k}%`
        ).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      results.investigations = data || [];
    }

    if (request.query_type === 'knowledge_base' || request.query_type === 'comprehensive') {
      let query = supabase.from('knowledge_base_articles').select('*, knowledge_base_categories(*)');
      
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => 
          `title.ilike.%${k}%,content.ilike.%${k}%,summary.ilike.%${k}%`
        ).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.limit(limit).order('updated_at', { ascending: false });
      if (error) throw error;
      results.knowledge_base = data || [];
    }

    if (request.query_type === 'monitoring_history' || request.query_type === 'comprehensive') {
      let query = supabase.from('monitoring_history').select('*');
      
      if (filters.time_range?.start) {
        query = query.gte('scan_started_at', filters.time_range.start);
      }
      if (filters.time_range?.end) {
        query = query.lte('scan_started_at', filters.time_range.end);
      }
      if (filters.status?.length) {
        query = query.in('status', filters.status);
      }
      
      const { data, error } = await query.limit(limit).order('scan_started_at', { ascending: false });
      if (error) throw error;
      results.monitoring_history = data || [];
    }

    if (request.query_type === 'travel' || request.query_type === 'comprehensive') {
      let query = supabase.from('itineraries').select('*, travelers(*)');
      query = applyFilters(query);
      
      if (filters.keywords?.length) {
        const keywordFilter = filters.keywords.map(k => 
          `destination_country.ilike.%${k}%,destination_city.ilike.%${k}%,trip_name.ilike.%${k}%`
        ).join(',');
        query = query.or(keywordFilter);
      }
      
      const { data, error } = await query.order('departure_date', { ascending: false });
      if (error) throw error;
      results.travel = data || [];
    }

    // Format output based on request
    let output: Record<string, unknown> = results;
    
    if (request.output_format === 'summary') {
      output = {
        query_type: request.query_type,
        timestamp: new Date().toISOString(),
        summary: {
          signals_count: (results.signals as unknown[])?.length || 0,
          incidents_count: (results.incidents as unknown[])?.length || 0,
          entities_count: (results.entities as unknown[])?.length || 0,
          clients_count: (results.clients as unknown[])?.length || 0,
          documents_count: (results.documents as unknown[])?.length || 0,
          investigations_count: (results.investigations as unknown[])?.length || 0,
          knowledge_base_count: (results.knowledge_base as unknown[])?.length || 0,
          monitoring_history_count: (results.monitoring_history as unknown[])?.length || 0,
          travel_count: (results.travel as unknown[])?.length || 0,
        },
        filters_applied: filters,
        data: results
      };
    } else if (request.output_format === 'detailed') {
      // Add metadata to each result set
      output = {
        query_type: request.query_type,
        timestamp: new Date().toISOString(),
        reason_for_access: request.reason_for_access,
        agent_id: request.agent_id,
        filters_applied: filters,
        data: results,
        metadata: {
          total_records: Object.values(results).reduce((acc: number, arr) => acc + ((arr as unknown[])?.length || 0), 0),
          query_types_included: Object.keys(results).filter(k => (results[k] as unknown[])?.length > 0)
        }
      };
    }

    return new Response(
      JSON.stringify(output),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in query-fortress-data:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
