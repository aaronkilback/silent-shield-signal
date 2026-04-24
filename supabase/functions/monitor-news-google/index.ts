import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { extractOGImage } from "../_shared/og-image.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

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

    // Get all clients with monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry, monitoring_keywords');

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

      // Add client name as primary query
      queries.push(`"${client.name}" security OR threat OR incident`);
      queries.push(`"${client.name}" protest OR activist OR opposition`);

      // Add monitoring keywords — always scoped to Canada/BC to avoid
      // matching unrelated global use of broad terms like "LNG"
      if (client.monitoring_keywords?.length > 0) {
        for (const keyword of client.monitoring_keywords.slice(0, 3)) {
          queries.push(`"${keyword}" Canada OR "British Columbia" OR "BC" news`);
        }
      }

      // Add person entity name queries — searches for staff/VIPs by name
      // in news and activist contexts. These are the queries most likely to
      // surface targeted coverage, threats, or protest activity.
      const personNames = clientPersonsMap.get(client.id) || [];
      for (const name of personNames.slice(0, 6)) {
        queries.push(`"${name}" news OR threat OR protest OR harassment OR controversy`);
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
