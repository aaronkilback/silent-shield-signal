import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WebSearchParams {
  query: string;
  time_range?: {
    start?: string;
    end?: string;
  };
  language?: string;
  geographic_focus?: string;
  max_results?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
}

interface WebSearchResponse {
  summary: string;
  source_urls: SearchResult[];
  key_entities: string[];
  key_dates: string[];
  threat_indicators: string[];
  geographic_relevance: string[];
  query_metadata: {
    original_query: string;
    enhanced_query: string;
    time_range: string;
    geographic_focus: string;
    search_timestamp: string;
  };
  data_source: "verified" | "internal_only" | "no_data";
  reliability_note: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, time_range, geographic_focus, max_results } = await req.json() as WebSearchParams;
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GOOGLE_SEARCH_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
    const GOOGLE_SEARCH_ENGINE_ID = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log(`[perform-external-web-search] Query: "${query}", Geographic focus: ${geographic_focus || 'global'}`);

    // Step 1: ALWAYS search internal Fortress data first (this is REAL data)
    const internalResults = await searchInternalFortressData(supabase, query, geographic_focus, max_results || 10);
    
    // Step 2: Try real Google search if API keys are configured
    let externalResults: SearchResult[] = [];
    let dataSource: "verified" | "internal_only" | "no_data" = "internal_only";
    let reliabilityNote = "Results from Fortress internal database only. No external web search available.";

    if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
      try {
        externalResults = await performRealGoogleSearch(
          GOOGLE_SEARCH_API_KEY,
          GOOGLE_SEARCH_ENGINE_ID,
          query,
          geographic_focus,
          max_results || 5
        );
        if (externalResults.length > 0) {
          dataSource = "verified";
          reliabilityNote = "Results include verified external web sources via Google Search API.";
        }
      } catch (searchError) {
        console.error("[perform-external-web-search] Google Search error:", searchError);
        reliabilityNote = "External search failed. Results from Fortress internal database only.";
      }
    } else {
      console.log("[perform-external-web-search] No Google Search API configured - using internal data only");
    }

    // Build response from REAL data only
    const response: WebSearchResponse = {
      summary: buildSummaryFromRealData(internalResults, externalResults, query),
      source_urls: externalResults,
      key_entities: internalResults.entities.map(e => e.name),
      key_dates: internalResults.signals
        .filter(s => s.created_at)
        .slice(0, 5)
        .map(s => `${s.title}: ${new Date(s.created_at).toLocaleDateString()}`),
      threat_indicators: internalResults.entities
        .flatMap(e => e.threat_indicators || [])
        .filter(Boolean)
        .slice(0, 10),
      geographic_relevance: internalResults.entities
        .map(e => e.current_location)
        .filter(Boolean)
        .slice(0, 5),
      query_metadata: {
        original_query: query,
        enhanced_query: `${query} ${geographic_focus || ""}`.trim(),
        time_range: time_range ? `${time_range.start || 'any'} - ${time_range.end || 'present'}` : 'Last 12 months',
        geographic_focus: geographic_focus || 'Global',
        search_timestamp: new Date().toISOString(),
      },
      data_source: dataSource,
      reliability_note: reliabilityNote,
    };

    // If no real data found at all, return explicit no-data response
    if (internalResults.signals.length === 0 && 
        internalResults.entities.length === 0 && 
        externalResults.length === 0) {
      response.data_source = "no_data";
      response.summary = `No verified intelligence found for query: "${query}". External web search is not available. Only Fortress internal database was searched.`;
      response.reliability_note = "NO DATA AVAILABLE. Do not fabricate or invent information.";
    }

    console.log(`[perform-external-web-search] Response: ${response.data_source}, ${internalResults.signals.length} internal signals, ${externalResults.length} external sources`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[perform-external-web-search] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        data_source: "no_data",
        reliability_note: "Search failed. Do not fabricate information."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function searchInternalFortressData(
  supabase: any,
  query: string,
  geographic_focus?: string,
  maxResults: number = 10
): Promise<{ signals: any[]; entities: any[]; documents: any[] }> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  // Search signals
  let signalsQuery = supabase
    .from("signals")
    .select("id, title, description, source_type, severity, created_at, source_url")
    .order("created_at", { ascending: false })
    .limit(maxResults);
  
  if (keywords.length > 0) {
    const orConditions = keywords.map(k => `title.ilike.%${k}%,description.ilike.%${k}%`).join(",");
    signalsQuery = signalsQuery.or(orConditions);
  }
  
  const { data: signals, error: signalsError } = await signalsQuery;
  if (signalsError) console.error("[perform-external-web-search] Signals query error:", signalsError);
  
  // Search entities
  let entitiesQuery = supabase
    .from("entities")
    .select("id, name, type, description, threat_indicators, current_location, risk_level")
    .eq("is_active", true)
    .limit(maxResults);
  
  if (keywords.length > 0) {
    const orConditions = keywords.map(k => `name.ilike.%${k}%,description.ilike.%${k}%`).join(",");
    entitiesQuery = entitiesQuery.or(orConditions);
  }
  
  if (geographic_focus) {
    entitiesQuery = entitiesQuery.ilike("current_location", `%${geographic_focus}%`);
  }
  
  const { data: entities, error: entitiesError } = await entitiesQuery;
  if (entitiesError) console.error("[perform-external-web-search] Entities query error:", entitiesError);
  
  // Search archival documents
  let docsQuery = supabase
    .from("archival_documents")
    .select("id, filename, summary, keywords, tags")
    .limit(5);
  
  if (keywords.length > 0) {
    const orConditions = keywords.map(k => `filename.ilike.%${k}%,summary.ilike.%${k}%`).join(",");
    docsQuery = docsQuery.or(orConditions);
  }
  
  const { data: documents, error: docsError } = await docsQuery;
  if (docsError) console.error("[perform-external-web-search] Documents query error:", docsError);
  
  return {
    signals: signals || [],
    entities: entities || [],
    documents: documents || [],
  };
}

async function performRealGoogleSearch(
  apiKey: string,
  engineId: string,
  query: string,
  geographic_focus?: string,
  maxResults: number = 5
): Promise<SearchResult[]> {
  const enhancedQuery = geographic_focus ? `${query} ${geographic_focus}` : query;
  
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(enhancedQuery)}&num=${Math.min(maxResults, 10)}`;
  
  const response = await fetch(searchUrl);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error("[perform-external-web-search] Google API error:", response.status, errorText);
    throw new Error(`Google Search API error: ${response.status}`);
  }
  
  const data = await response.json();
  const items = data.items || [];
  
  return items.map((item: any) => ({
    title: item.title || "Untitled",
    url: item.link || "",
    snippet: item.snippet || "",
    published_date: item.pagemap?.metatags?.[0]?.["article:published_time"] || undefined,
  }));
}

function buildSummaryFromRealData(
  internalResults: { signals: any[]; entities: any[]; documents: any[] },
  externalResults: SearchResult[],
  query: string
): string {
  const parts: string[] = [];
  
  if (internalResults.signals.length > 0) {
    parts.push(`Found ${internalResults.signals.length} relevant signals in Fortress database.`);
    const recentSignals = internalResults.signals.slice(0, 3);
    if (recentSignals.length > 0) {
      parts.push("Recent signals: " + recentSignals.map(s => s.title).join("; "));
    }
  }
  
  if (internalResults.entities.length > 0) {
    parts.push(`${internalResults.entities.length} relevant entities identified.`);
  }
  
  if (externalResults.length > 0) {
    parts.push(`${externalResults.length} external web sources found.`);
  }
  
  if (parts.length === 0) {
    return `No verified intelligence found for query: "${query}".`;
  }
  
  return parts.join(" ");
}
