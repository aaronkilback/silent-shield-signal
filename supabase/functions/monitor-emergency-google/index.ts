import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";
import { scoreSignalRelevance, isTestContent } from "../_shared/signal-relevance-scorer.ts";

// ═══ DOMAIN BLOCKLIST ═══
// Social media, entertainment, and e-commerce domains that should never produce emergency signals
const BLOCKED_DOMAINS = [
  'tiktok.com', 'instagram.com', 'facebook.com', 'reddit.com',
  'youtube.com', 'twitter.com', 'x.com', 'pinterest.com', 'tumblr.com',
  'substack.com', 'medium.com', 'eventbrite.com', 'meetup.com',
  'amazon.com', 'ebay.com', 'aliexpress.com', 'walmart.com',
  'imdb.com', 'rottentomatoes.com', 'goodreads.com',
  'timesofindia.indiatimes.com', 'timesnownews.com', 'ndtv.com',
  'hindustantimes.com', 'thehindu.com', 'indiatoday.in',
  'nytimes.com', 'msn.com', 'foxnews.com', 'nypost.com', // US-focused outlets
];

/**
 * AI relevance gate — uses Gemini to verify a Google result is a genuine,
 * current, actionable emergency in Western Canada before ingestion.
 */
async function aiRelevanceGate(
  title: string,
  snippet: string,
  url: string,
  displayLink: string,
  searchQuery: string,
): Promise<{ relevant: boolean; location: string | null; reason: string }> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  ;
  }

  const prompt = `You are a signal relevance filter for a Canadian corporate security platform focused on Western Canada (British Columbia, Alberta, Saskatchewan, NWT, Yukon). 

Evaluate this Google search result and determine if it describes a GENUINE, CURRENT, ACTIONABLE emergency event physically occurring in Canada.

Title: ${title}
Snippet: ${snippet}
URL: ${url}
Domain: ${displayLink}
Search query used: ${searchQuery}

REJECT if ANY of these are true:
- Event is NOT in Canada (India, USA, UK, etc.)
- It's a social media post, meme, entertainment, or opinion piece
- It's historical content (event happened more than 7 days ago)
- It's a product listing, event listing, or promotional content
- It's a general news article about crime/violence outside Canada
- The emergency keywords appear only in tangential context (e.g., article about AI mentions "blackmail")
- It's a TikTok, Instagram reel, Reddit thread, or blog post

ACCEPT only if:
- A real emergency event is occurring or just occurred in Canada
- The content describes an actionable security situation (shooting, bomb threat, evacuation, AMBER alert, etc.)
- The source is a credible news outlet or official agency

Respond in this exact JSON format only:
{"relevant": true/false, "location": "City, Province" or null, "reason": "one sentence explanation"}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      console.warn(`[EmergencyGoogle] AI gate returned ${response.status}, falling back to permissive`);
      return { relevant: true, location: null, reason: 'ai_error_fallback' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        relevant: parsed.relevant === true,
        location: parsed.location || null,
        reason: parsed.reason || 'unknown',
      };
    }
    
    return { relevant: true, location: null, reason: 'ai_parse_fallback' };
  } catch (err) {
    console.warn(`[EmergencyGoogle] AI gate error: ${err}`);
    return { relevant: true, location: null, reason: 'ai_exception_fallback' };
  }
}

// Emergency keywords that MUST appear in the content for it to be a real emergency signal
// STRICT: Each pattern must indicate a genuine, actionable emergency — not just news
const EMERGENCY_CONTENT_VALIDATORS = [
  /\bactive\s+shooter\b/i,
  /\bshots?\s+fired\b/i,
  /\barmed\s+(person|suspect|individual)\b/i,
  /\bbomb\s+threat\b/i,
  /\bsuspicious\s+package\b/i,
  /\bhostage\s+(situation|crisis|taking|taker)\b/i,
  /\bbarricade[d]?\s+(suspect|situation|person)\b/i,
  /\bstandoff\b.*\b(police|RCMP|officer|armed)\b/i,
  /\bmass\s+casualt(y|ies)\b/i,
  /\bmultiple\s+victims?\b/i,
  /\bmass\s+stabbing\b/i,
  /\bamber\s+alert\b/i,
  /\bchild\s+abduction\b/i,
  /\bevacuation\s+order\b/i,
  /\bcivil\s+emergency\b/i,
  /\bterrorist\s+(attack|plot|threat|suspect)\b/i,
  /\bschool\s+shoot/i,
  /\bmass\s+shooting\b/i,
  /\bkilled\b.*\b(shoot|attack|stab)/i,
  /\bdead\b.*\b(shoot|attack|incident)/i,
];

// Broad patterns that match too much noise — excluded from validators
// Previously included: /\blockdown\b/, /\bRCMP\b/, /\bpolice\s+(respond|investigating|confirm)/i, /\bradicalized\b/

// Commercial/product patterns that should NEVER be ingested as emergencies
const COMMERCIAL_EXCLUSION_PATTERNS = [
  /\b(shop|buy|price|store|sale|discount|order|cart|shipping)\b/i,
  /\b(camera|cctv|surveillance|equipment|product|device)\b.*\b(explosion\s*proof|bulletproof|bullet\s*proof)\b/i,
  /\b(explosion\s*proof|bulletproof|bullet\s*proof)\b.*\b(camera|cctv|surveillance|equipment|product|device)\b/i,
  /\bcamera\s+\d{4}\b/i,  // Camera model numbers
  /\bpromitel\b/i,
  /\baxis\b.*\b[A-Z]{2,3}\d{3,4}\b/i, // AXIS model numbers
  /\b(amazon|ebay|aliexpress|alibaba|walmart)\b/i,
  /\bswampflix\b/i, // Entertainment site
  /\bon\s+this\s+day\b/i, // Historical "on this day" content
  /\bborn\s+(on|in)\s+\d{4}\b/i, // Biographical dates
  /\bdied\s+(on|in)\s+\d{4}\b/i, // Biographical dates
  /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+1[89]\d{2}\b/i, // Historical dates pre-2000
  /\b(countess|duchess|baron|earl|marquess)\b/i, // Noble titles = historical content
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

          // ═══ DOMAIN BLOCKLIST GATE ═══
          const domainLower = (item.displayLink || '').toLowerCase();
          const isDomainBlocked = BLOCKED_DOMAINS.some(d => domainLower.includes(d));
          if (isDomainBlocked) {
            console.log(`[EmergencyGoogle] ✗ Blocked domain: ${item.displayLink} — ${item.title.substring(0, 50)}`);
            continue;
          }

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

          // ═══ COMMERCIAL/IRRELEVANT EXCLUSION GATE ═══
          // Reject product listings, historical content, and entertainment
          const isCommercialOrIrrelevant = COMMERCIAL_EXCLUSION_PATTERNS.some(pattern => pattern.test(fullText));
          if (isCommercialOrIrrelevant) {
            console.log(`[EmergencyGoogle] ✗ Excluded commercial/irrelevant: ${item.title.substring(0, 60)}`);
            continue;
          }

          // Skip test content
          if (isTestContent(fullText)) continue;

          // ═══ AI RELEVANCE GATE (Gemini) ═══
          // Verify this is a genuine, current Canadian emergency — not global noise
          const aiVerdict = await aiRelevanceGate(item.title, item.snippet, item.link, item.displayLink, query);
          if (!aiVerdict.relevant) {
            console.log(`[EmergencyGoogle] ✗ AI rejected: "${item.title.substring(0, 50)}" — ${aiVerdict.reason}`);
            continue;
          }

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
              normalized_text: item.title,
              signal_type: 'emergency',
              category,
              severity,
              location: aiVerdict.location || 'Canada',
              content_hash: contentHash,
              relevance_score: relevanceResult.score,
              raw_json: {
                source: 'google_emergency_keywords',
                source_url: item.link,
                url: item.link,
                link: item.link,
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
