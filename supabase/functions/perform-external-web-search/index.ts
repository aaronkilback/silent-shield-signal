import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { query, time_range, geographic_focus, max_results } = await req.json() as WebSearchParams;
    
    if (!query) {
      return errorResponse("Query is required", 400);
    }

    const GOOGLE_SEARCH_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
    const GOOGLE_SEARCH_ENGINE_ID = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
    
    const supabase = createServiceClient();

    console.log(`[perform-external-web-search] Query: "${query}", Geographic focus: ${geographic_focus || 'global'}`);

    // Step 1: ALWAYS search internal Fortress data first
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

    if (internalResults.signals.length === 0 && 
        internalResults.entities.length === 0 && 
        externalResults.length === 0) {
      response.data_source = "no_data";
      response.summary = `No verified intelligence found for query: "${query}". External web search is not available. Only Fortress internal database was searched.`;
      response.reliability_note = "NO DATA AVAILABLE. Do not fabricate or invent information.";
    }

    console.log(`[perform-external-web-search] Response: ${response.data_source}, ${internalResults.signals.length} internal signals, ${externalResults.length} external sources`);

    return successResponse(response);
  } catch (error) {
    console.error("[perform-external-web-search] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
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
    .select("id, title, description, signal_type, severity, created_at, source_id")
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
  
  const extractPublishedDate = (item: any): string | undefined => {
    const metatags = item.pagemap?.metatags?.[0] || {};
    
    const dateFields = [
      metatags["article:published_time"],
      metatags["og:article:published_time"],
      metatags["datePublished"],
      metatags["date"],
      metatags["pubdate"],
      metatags["DC.date"],
      metatags["sailthru.date"],
    ];
    
    for (const dateStr of dateFields) {
      if (dateStr) {
        try {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime()) && parsed <= new Date()) {
            return parsed.toISOString().split('T')[0];
          }
        } catch { continue; }
      }
    }
    
    const urlDateMatch = item.link?.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/|[-_](\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
    if (urlDateMatch) {
      const year = urlDateMatch[1] || urlDateMatch[4];
      const month = (urlDateMatch[2] || urlDateMatch[5])?.padStart(2, '0');
      const day = (urlDateMatch[3] || urlDateMatch[6])?.padStart(2, '0');
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    }
    
    return undefined;
  };
  
  const classifyAge = (dateStr: string | undefined): 'current' | 'historical' | 'dated' | 'unknown' => {
    if (!dateStr) return 'unknown';
    try {
      const pubDate = new Date(dateStr);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 7) return 'current';
      if (daysDiff <= 30) return 'historical';
      return 'dated';
    } catch {
      return 'unknown';
    }
  };
  
  return items.map((item: any) => {
    const publishedDate = extractPublishedDate(item);
    const ageClass = classifyAge(publishedDate);
    
    return {
      title: item.title || "Untitled",
      url: item.link || "",
      snippet: item.snippet || "",
      published_date: publishedDate,
      age_classification: ageClass,
      date_warning: ageClass === 'dated' ? '⚠️ DATED: Content may be outdated' :
                    ageClass === 'historical' ? '📜 HISTORICAL: Not recent news' :
                    ageClass === 'unknown' ? '❓ DATE UNKNOWN: Treat as historical' : null,
    };
  });
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
    const current = externalResults.filter(r => (r as any).age_classification === 'current');
    const historical = externalResults.filter(r => (r as any).age_classification === 'historical');
    const dated = externalResults.filter(r => (r as any).age_classification === 'dated');
    const unknown = externalResults.filter(r => (r as any).age_classification === 'unknown');
    
    const summary: string[] = [];
    if (current.length > 0) summary.push(`${current.length} current (≤7 days)`);
    if (historical.length > 0) summary.push(`${historical.length} historical (7-30 days)`);
    if (dated.length > 0) summary.push(`${dated.length} dated (>30 days)`);
    if (unknown.length > 0) summary.push(`${unknown.length} unknown date`);
    
    parts.push(`${externalResults.length} external web sources found: ${summary.join(', ')}.`);
    
    const oldCount = historical.length + dated.length + unknown.length;
    if (oldCount > current.length) {
      parts.push("⚠️ NOTE: Most results are historical - may not reflect current situation.");
    }
  }
  
  if (parts.length === 0) {
    return `No verified intelligence found for query: "${query}".`;
  }
  
  return parts.join(" ");
}
