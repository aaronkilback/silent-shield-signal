import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";

/**
 * Google News Emergency Keyword Monitor
 * 
 * Performs targeted Google Custom Search queries for high-priority
 * emergency keywords: active shooter, bombing, hostage, mass casualty, etc.
 * Uses the existing GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.
 */

const EMERGENCY_QUERIES = [
  '"active shooter" OR "armed person" OR "shots fired" Canada',
  '"bomb threat" OR "explosion" OR "suspicious package" Canada',
  '"hostage" OR "barricade" OR "standoff" Canada police',
  '"mass casualty" OR "multiple victims" OR "mass stabbing" Canada',
  '"AMBER alert" OR "child abduction" Canada',
  '"evacuation order" OR "civil emergency" Canada',
  '"terrorist" OR "terrorism" OR "radicalized" Canada RCMP',
];

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const historyEntry = await createHistoryEntry(supabase, 'Google Emergency Keywords');

  try {
    console.log('[EmergencyGoogle] Starting emergency keyword scan...');

    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!googleApiKey || !googleEngineId) {
      console.warn('[EmergencyGoogle] Google Search API not configured');
      if (historyEntry?.id) {
        await completeHistoryEntry(supabase, historyEntry.id, 0, 0);
      }
      return successResponse({
        success: false,
        error: 'Google Search API not configured',
      });
    }

    // Fetch all clients for matching
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, locations, monitoring_keywords');

    let totalItems = 0;
    let signalsCreated = 0;
    const results: any[] = [];

    for (const query of EMERGENCY_QUERIES) {
      try {
        const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
        searchUrl.searchParams.set('key', googleApiKey);
        searchUrl.searchParams.set('cx', googleEngineId);
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('num', '5');
        searchUrl.searchParams.set('dateRestrict', 'd1'); // Last 24 hours only
        searchUrl.searchParams.set('sort', 'date');

        console.log(`[EmergencyGoogle] Searching: ${query.substring(0, 60)}...`);

        const response = await fetch(searchUrl.toString());
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[EmergencyGoogle] API error: ${response.status} - ${errorText}`);
          continue;
        }

        const data = await response.json();
        const items: SearchResult[] = data.items || [];
        totalItems += items.length;

        for (const item of items) {
          // Content hash for dedup
          const encoder = new TextEncoder();
          const hashData = encoder.encode(`${item.link}|${item.title}`);
          const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          // Check rejected hashes
          const { data: rejected } = await supabase
            .from('rejected_content_hashes')
            .select('id')
            .eq('content_hash', contentHash)
            .maybeSingle();

          if (rejected) continue;

          // Check existing signal
          const { data: existing } = await supabase
            .from('signals')
            .select('id')
            .eq('content_hash', contentHash)
            .maybeSingle();

          if (existing) continue;

          // Classify severity from content
          const fullText = `${item.title} ${item.snippet}`.toLowerCase();
          let severity = 'high';
          let category = 'emergency';

          if (/active shooter|shots fired|armed person|mass casualty|mass stabbing/.test(fullText)) {
            severity = 'critical';
            category = 'active_threat';
          } else if (/bomb|explosion|terrorist|terrorism/.test(fullText)) {
            severity = 'critical';
            category = 'terrorism';
          } else if (/amber alert|child abduction/.test(fullText)) {
            severity = 'critical';
            category = 'amber_alert';
          } else if (/hostage|barricade|standoff/.test(fullText)) {
            severity = 'critical';
            category = 'hostage';
          } else if (/evacuation|civil emergency/.test(fullText)) {
            severity = 'high';
            category = 'civil_emergency';
          }

          // Match to client
          let matchedClientId: string | null = null;
          if (clients) {
            for (const client of clients) {
              const locations = (client.locations || []).map((l: string) => l.toLowerCase());
              const keywords = (client.monitoring_keywords || []).map((k: string) => k.toLowerCase());

              const locationMatch = locations.some((loc: string) => fullText.includes(loc));
              const keywordMatch = keywords.some((kw: string) => fullText.includes(kw));
              const nameMatch = fullText.includes(client.name.toLowerCase());

              if (locationMatch || keywordMatch || nameMatch) {
                matchedClientId = client.id;
                break;
              }
            }
          }

          const { error: signalError } = await supabase
            .from('signals')
            .insert({
              client_id: matchedClientId,
              normalized_text: `[Emergency Alert] ${item.title}`,
              category,
              severity,
              location: item.displayLink || 'Canada',
              content_hash: contentHash,
              raw_json: {
                source: 'google_emergency_keywords',
                url: item.link,
                snippet: item.snippet,
                display_link: item.displayLink,
                search_query: query,
              },
              status: 'new',
              confidence: 0.90,
            });

          if (!signalError) {
            signalsCreated++;
            console.log(`[EmergencyGoogle] ✓ ${severity.toUpperCase()}: ${item.title.substring(0, 70)}`);
            results.push({
              title: item.title,
              severity,
              category,
              url: item.link,
            });
          }
        }

        // Rate limiting between queries
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (queryError) {
        console.error(`[EmergencyGoogle] Query error:`, queryError);
      }
    }

    if (historyEntry?.id) {
      await completeHistoryEntry(supabase, historyEntry.id, totalItems, signalsCreated);
    }

    console.log(`[EmergencyGoogle] Complete. Scanned ${totalItems} items, created ${signalsCreated} signals.`);

    return successResponse({
      success: true,
      items_scanned: totalItems,
      signals_created: signalsCreated,
      sample: results.slice(0, 5),
    });

  } catch (error) {
    console.error('[EmergencyGoogle] Monitor error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (historyEntry?.id) {
      await failHistoryEntry(supabase, historyEntry.id, errorMessage);
    }
    return errorResponse(errorMessage, 500);
  }
});
