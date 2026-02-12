import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";
import { scoreSignalRelevance, isTestContent } from "../_shared/signal-relevance-scorer.ts";

// Emergency keywords that MUST appear in the content for it to be a real emergency signal
const EMERGENCY_CONTENT_VALIDATORS = [
  /\bactive\s+shooter\b/i,
  /\bshots?\s+fired\b/i,
  /\barmed\s+(person|suspect|individual)\b/i,
  /\bbomb\s+threat\b/i,
  /\bexplosion\b/i,
  /\bsuspicious\s+package\b/i,
  /\bhostage\b/i,
  /\bbarricade[d]?\b/i,
  /\bstandoff\b/i,
  /\bmass\s+casualt(y|ies)\b/i,
  /\bmultiple\s+victims?\b/i,
  /\bmass\s+stabbing\b/i,
  /\bamber\s+alert\b/i,
  /\bchild\s+abduction\b/i,
  /\bevacuation\s+order\b/i,
  /\bcivil\s+emergency\b/i,
  /\bterroris[tm]\b/i,
  /\bradicalized\b/i,
  /\bschool\s+shoot/i,
  /\bmass\s+shooting\b/i,
  /\blockdown\b/i,
  /\bRCMP\b/,
  /\bpolice\s+(respond|investigating|confirm)/i,
  /\bkilled\b.*\b(shoot|attack|stab)/i,
  /\bdead\b.*\b(shoot|attack|incident)/i,
];

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

          // ═══ CONTENT VALIDATION GATE ═══
          // Google results often include irrelevant pages. Require at least one
          // emergency keyword to actually appear in the title or snippet.
          const fullText = `${item.title} ${item.snippet}`;
          const fullTextLower = fullText.toLowerCase();

          const hasEmergencyContent = EMERGENCY_CONTENT_VALIDATORS.some(pattern => pattern.test(fullText));
          if (!hasEmergencyContent) {
            console.log(`[EmergencyGoogle] ✗ Skipping non-emergency result: ${item.title.substring(0, 60)}`);
            continue;
          }

          // Skip test content
          if (isTestContent(fullText)) continue;

          // Run through relevance scorer for additional filtering
          const relevanceResult = await scoreSignalRelevance(
            supabase,
            fullText,
            'emergency',
            70,
            'google_emergency_keywords'
          );

          if (relevanceResult.recommendation === 'suppress') {
            console.log(`[EmergencyGoogle] ✗ Suppressed by relevance scorer: ${item.title.substring(0, 60)}`);
            continue;
          }

          // Classify severity from content
          let severity = 'high';
          let category = 'emergency';

          if (/active shooter|shots fired|armed person|mass casualty|mass stabbing/i.test(fullTextLower)) {
            severity = 'critical';
            category = 'active_threat';
          } else if (/bomb|explosion|terrorist|terrorism/i.test(fullTextLower)) {
            severity = 'critical';
            category = 'terrorism';
          } else if (/amber alert|child abduction/i.test(fullTextLower)) {
            severity = 'critical';
            category = 'amber_alert';
          } else if (/hostage|barricade|standoff/i.test(fullTextLower)) {
            severity = 'critical';
            category = 'hostage';
          } else if (/evacuation|civil emergency/i.test(fullTextLower)) {
            severity = 'high';
            category = 'civil_emergency';
          }

          // Match to client
          let matchedClientId: string | null = null;
          if (clients) {
            for (const client of clients) {
              const locations = (client.locations || []).map((l: string) => l.toLowerCase());
              const keywords = (client.monitoring_keywords || []).map((k: string) => k.toLowerCase());

              const locationMatch = locations.some((loc: string) => fullTextLower.includes(loc));
              const keywordMatch = keywords.some((kw: string) => fullTextLower.includes(kw));
              const nameMatch = fullTextLower.includes(client.name.toLowerCase());

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
              relevance_score: relevanceResult.score,
              raw_json: {
                source: 'google_emergency_keywords',
                url: item.link,
                snippet: item.snippet,
                display_link: item.displayLink,
                search_query: query,
                relevance_factors: relevanceResult.factors,
              },
              status: relevanceResult.recommendation === 'low_confidence' ? 'low_confidence' : 'new',
              confidence: relevanceResult.confidence,
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
