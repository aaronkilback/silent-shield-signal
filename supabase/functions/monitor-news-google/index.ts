import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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
      
      // Add monitoring keywords
      if (client.monitoring_keywords?.length > 0) {
        for (const keyword of client.monitoring_keywords.slice(0, 3)) {
          queries.push(`"${keyword}" news`);
        }
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
            // Generate content hash for deduplication
            const contentToHash = `${item.link}|${item.title}`;
            const encoder = new TextEncoder();
            const hashData = encoder.encode(contentToHash);
            const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            // Check for existing signal
            const { data: existingSignal } = await supabase
              .from('signals')
              .select('id')
              .eq('content_hash', contentHash)
              .single();

            if (existingSignal) {
              console.log(`Skipping duplicate: ${item.title?.substring(0, 50)}...`);
              continue;
            }

            // Determine category and severity
            const fullContent = `${item.title} ${item.snippet}`.toLowerCase();
            let category = 'news';
            let severity = 'low';

            if (/breach|hack|cyber|ransomware|malware|zero-day|exploit/.test(fullContent)) {
              category = 'cybersecurity';
              severity = 'high';
            } else if (/protest|activist|opposition|blockade|demonstration/.test(fullContent)) {
              category = 'protest';
              severity = 'medium';
            } else if (/lawsuit|investigation|fine|penalty|regulatory/.test(fullContent)) {
              category = 'regulatory';
              severity = 'medium';
            } else if (/deal|acquisition|merger|partnership|contract/.test(fullContent)) {
              category = 'business_intelligence';
              severity = 'low';
            }

            // Extract event_date from snippet date patterns (e.g., "Jan 15, 2025", "2025-03-01")
            let eventDate: string | null = null;
            const snippetText = item.snippet || '';
            const dateMatch = snippetText.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b)/i)
              || snippetText.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              try {
                const parsed = new Date(dateMatch[1]);
                if (!isNaN(parsed.getTime())) {
                  eventDate = parsed.toISOString();
                }
              } catch { /* ignore */ }
            }

            // Create signal
            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: `[Google News] ${item.title}`,
                category,
                severity,
                location: item.displayLink || 'Web',
                content_hash: contentHash,
                raw_json: {
                  source: 'google_news_api',
                  url: item.link,
                  snippet: item.snippet,
                  display_link: item.displayLink,
                  search_query: query,
                  matched_client: client.name
                },
                status: 'new',
                confidence: 0.85,
                event_date: eventDate
              });

            if (!signalError) {
              signalsCreated++;
              console.log(`✓ Created signal for ${client.name}: ${item.title?.substring(0, 60)}...`);

              searchResults.push({
                client: client.name,
                title: item.title,
                url: item.link,
                category,
                severity
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
