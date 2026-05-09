import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { extractOGImage } from "../_shared/og-image.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

// A truncated headline ending in a stray initial — "for the B.",
// "criticized U.", "the U." — signals the source title was clipped
// by Google CSE's preview machinery. The underlying content can still
// be relevant, but a truncated title makes the signal hard to triage
// without the full article. We DON'T reject these (the content may
// matter); we DO log them so we can tune later if they're noisy.
function looksTruncated(title: string | null | undefined): boolean {
  if (!title) return false;
  // Trailing single capital letter + period (e.g. "for the B.")
  if (/\s[A-Z]\.\s*$/.test(title)) return true;
  // Trailing "the X." pattern
  if (/\bthe\s+[A-Z]\.\s*$/.test(title)) return true;
  return false;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
  const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

  // Create monitoring history entry
  const { data: historyEntry } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Google News API',
      status: 'running',
      scan_metadata: { method: 'google_custom_search' }
    })
    .select()
    .single();

  try {
    console.log('Starting Google News API monitoring scan...');

    // 2026-05-08: write heartbeat at the START. With 70+ keyword queries
    // per run (29 Petronas + 43 BCCH client keywords), this function
    // routinely exceeds the 150s edge-function execution limit and gets
    // killed before reaching the end-of-function heartbeat at line 278.
    // The Monitor Health panel was showing 3-day staleness despite the
    // function actually firing every hour — heartbeat was the missing
    // signal. Writing 'running' here gives operators visibility even if
    // the run gets cut short.
    await recordHeartbeat(supabase, 'monitor-news-google-hourly', 'running', { phase: 'started' });

    if (!googleApiKey || !googleEngineId) {
      console.warn('Google Search API not configured - using fallback RSS method');
      
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          error_message: 'Google Search API not configured',
          signals_created: 0
        })
        .eq('id', historyEntry?.id);

      return successResponse({ 
        success: false, 
        error: 'Google Search API not configured',
        fallback: 'Use monitor-news for RSS-based fallback'
      });
    }

    // Get all clients with monitoring keywords + negative-keyword
    // config. Negative keywords are appended to every Google CSE
    // query for that client as `-term` exclusions, pushing out
    // content matching unwanted scope (e.g. Petronas's Malaysian
    // HQ news for the Petronas Canada client). Stored on
    // clients.monitoring_config.negative_keywords as a JSON array
    // of strings.
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry, monitoring_keywords, monitoring_config');

    if (clientsError) throw clientsError;

    // Fetch actively monitored person entities per client
    const { data: monitoredEntities } = await supabase
      .from('entities')
      .select('id, name, client_id, attributes')
      .eq('active_monitoring_enabled', true)
      .eq('type', 'person');

    // Build map: client_id → person entity names
    const clientPersonsMap = new Map<string, string[]>();
    for (const e of monitoredEntities || []) {
      if (!e.client_id) continue;
      const list = clientPersonsMap.get(e.client_id) || [];
      list.push(e.name);
      clientPersonsMap.set(e.client_id, list);
    }

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;
    let itemsScanned = 0;
    const searchResults: any[] = [];

    // Build search queries for each client
    for (const client of clients || []) {
      const queries: string[] = [];

      // Build the negative-keyword suffix once per client. Each
      // configured negative keyword is appended as a `-term` Google
      // CSE exclusion — pushes out content scoped against unwanted
      // geography or topics. For Petronas Canada this excludes the
      // Malaysian HQ content (Sabah, Sarawak, Bintulu, RGT-3, FSRU,
      // Kuala Lumpur, Bursa Malaysia, etc.) that was leaking into
      // the Canadian feed via global "Petronas" keyword matches.
      // Multi-word negatives are wrapped in quotes so they match as
      // a phrase rather than exclude every article containing any
      // of the words separately.
      const negativeKeywords: string[] = Array.isArray(client.monitoring_config?.negative_keywords)
        ? client.monitoring_config.negative_keywords.filter((k: any) => typeof k === 'string' && k.trim().length > 0)
        : [];
      const negSuffix = negativeKeywords
        .map((k) => (k.includes(' ') ? `-"${k}"` : `-${k}`))
        .join(' ');
      const withNeg = (q: string) => negSuffix ? `${q} ${negSuffix}` : q;

      // Add client name as primary query
      queries.push(withNeg(`"${client.name}" security OR threat OR incident`));
      queries.push(withNeg(`"${client.name}" protest OR activist OR opposition`));

      // Add monitoring keywords — always scoped to Canadian geography
      // to avoid matching unrelated global use of broad terms like
      // "LNG". The bare "BC" token is intentionally NOT in the scope
      // — Google CSE matches it to too many false positives ("B.C.
      // Smith" bylines, building codes, etc.) which let Malaysian
      // Petronas content through during May 2026 audit. Use the full
      // "British Columbia" string only.
      //
      // 2026-05-07: removed .slice(0, 3) cap. With it, 26 of Petronas's
      // 29 keywords (Wet'suwet'en, Gidimt'en, Coastal GasLink, Stand.earth,
      // pipeline protest BC, etc.) were never reaching Google News API —
      // 30-day reality probe returned 0 hits for any of those terms.
      if (client.monitoring_keywords?.length > 0) {
        for (const keyword of client.monitoring_keywords) {
          queries.push(withNeg(`"${keyword}" Canada OR "British Columbia" news`));
        }
      }

      // 2026-05-09: tactic-term queries that land protest/activism news
      // even when the article doesn't name a client-specific keyword.
      // Splunk Cookbook follow-up — broaden beyond named entities so
      // generic-coverage-quiet weeks (May 1-9 2026 had 0 protest signals
      // for 6 of 7 days because every monitor query required a Wet'suwet'en
      // / Coastal GasLink / Stand.earth-style proper-noun match) start
      // producing volume. Each tactic still gets the Canada/BC geo
      // restriction so we don't pull global protest news.
      const TACTIC_TERMS = [
        'direct action pipeline',
        'encampment First Nation',
        'land defenders blockade',
        'rail blockade Indigenous',
        'pipeline protest',
        'climate camp',
        'occupation protest',
        'gender clinic protest',
        'anti-trans protest',
        'parental rights protest',
      ];
      for (const tactic of TACTIC_TERMS) {
        queries.push(withNeg(`"${tactic}" Canada OR "British Columbia"`));
      }

      // Add person entity name queries — searches for staff/VIPs by name
      // in news and activist contexts. These are the queries most likely to
      // surface targeted coverage, threats, or protest activity.
      const personNames = clientPersonsMap.get(client.id) || [];
      for (const name of personNames.slice(0, 6)) {
        queries.push(withNeg(`"${name}" news OR threat OR protest OR harassment OR controversy`));
      }

      // Execute Google Custom Search for each query
      for (const query of queries) {
        try {
          const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
          searchUrl.searchParams.set('key', googleApiKey);
          searchUrl.searchParams.set('cx', googleEngineId);
          searchUrl.searchParams.set('q', query);
          searchUrl.searchParams.set('num', '5');
          searchUrl.searchParams.set('dateRestrict', 'd3'); // Last 3 days
          searchUrl.searchParams.set('sort', 'date');

          console.log(`Searching: ${query}`);
          
          const response = await fetch(searchUrl.toString());
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Google Search API error: ${response.status} - ${errorText}`);
            continue;
          }

          const data = await response.json();
          itemsScanned += data.items?.length || 0;

          for (const item of data.items || []) {
            // Skip results with no meaningful snippet
            const snippet = (item.snippet || '').trim();
            if (snippet.length < 40) continue;

            // 2026-05-08 source-fidelity guard: require title or snippet to
            // contain at least one client-specific token. Google CSE
            // sometimes returns tangentially-matched articles where the
            // search term appears only in metadata, not the article body.
            // The LLM then hallucinates rich prose from background knowledge.
            const clientTokens = (client.monitoring_keywords || [])
              .filter((k: string) => typeof k === 'string' && k.trim().length >= 3)
              .map((k: string) => k.toLowerCase());
            if (clientTokens.length > 0) {
              const haystack = `${item.title || ''} ${snippet}`.toLowerCase();
              const matched = clientTokens.some((tok: string) => haystack.includes(tok));
              if (!matched) {
                console.log(`[news-google] dropping no-token-match: ${item.title?.substring(0, 80)}`);
                continue;
              }
            }

            // Note truncated titles for telemetry — content is still
            // ingested (it may be operationally relevant) but we log
            // the marker so we can revisit if these prove noisy.
            if (looksTruncated(item.title)) {
              console.log(`[news-google] truncated-title marker on: ${item.title?.substring(0, 80)}`);
            }

            const signalText = `${item.title}\n\n${snippet}`;

            // Extract OG image from article page (non-blocking)
            const imageUrl = item.link ? await extractOGImage(item.link).catch(() => null) : null;

            // Route through ingest-signal for PECL classification, relevance gate, and dedup
            const ingestResult = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: signalText,
                source_url: item.link || null,
                image_url: imageUrl || undefined,
                client_id: client.id,
                source_key: 'Google News API',
                raw_json: {
                  source: 'google_news_api',
                  source_url: item.link,
                  snippet,
                  display_link: item.displayLink,
                  search_query: query,
                  matched_client: client.name,
                },
              },
            });

            if (ingestResult.error) {
              console.error(`ingest-signal error for "${item.title?.substring(0, 50)}":`, ingestResult.error);
              continue;
            }

            const ingestData = ingestResult.data as any;
            const ingestStatus = ingestData?.status || 'unknown';

            if (ingestStatus === 'rejected' || ingestStatus === 'suppressed' || ingestStatus === 'filed_as_update') {
              console.log(`↳ ${ingestStatus}: ${item.title?.substring(0, 50)}... (${ingestData?.reason || ingestData?.detail || ''})`);
              continue;
            }

            if (ingestData?.signal_id || ingestStatus === 'enqueued' || ingestStatus === 'critical_processed') {
              signalsCreated++;
              console.log(`✓ Created signal for ${client.name}: ${item.title?.substring(0, 60)}...`);
              searchResults.push({
                client: client.name,
                title: item.title,
                url: item.link,
                status: ingestStatus,
              });
            }
          }

          // Rate limit: wait between requests
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (queryError) {
          console.error(`Error processing query "${query}":`, queryError);
        }
      }
    }

    // Update monitoring history
    await supabase
      .from('monitoring_history')
      .update({
        status: 'completed',
        scan_completed_at: new Date().toISOString(),
        items_scanned: itemsScanned,
        signals_created: signalsCreated,
        scan_metadata: {
          method: 'google_custom_search',
          clients_monitored: clients?.length || 0,
          results_sample: searchResults.slice(0, 10)
        }
      })
      .eq('id', historyEntry?.id);

    // Heartbeat
  await recordHeartbeat(supabase, 'monitor-news-google-hourly', 'completed', { items_scanned: itemsScanned, signals_created: signalsCreated });

  console.log(`Google News monitoring complete. Scanned ${itemsScanned} items, created ${signalsCreated} signals.`);

    return successResponse({
      success: true,
      items_scanned: itemsScanned,
      signals_created: signalsCreated,
      clients_monitored: clients?.length || 0,
      sample_results: searchResults.slice(0, 5)
    });

  } catch (error) {
    console.error('Google News monitoring error:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await supabase
      .from('monitoring_history')
      .update({
        status: 'failed',
        scan_completed_at: new Date().toISOString(),
        error_message: errorMessage
      })
      .eq('id', historyEntry?.id);

    return errorResponse(errorMessage, 500);
  }
});
