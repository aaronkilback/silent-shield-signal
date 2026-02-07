import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseRSS(xmlText: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const description = itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || new Date().toISOString();
    
    items.push({ title, link, description, pubDate });
  }
  
  return items;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabaseClient = createServiceClient();

  // Create monitoring history entry
  const { data: historyEntry, error: historyError } = await supabaseClient
    .from('monitoring_history')
    .insert({
      source_name: 'RSS Sources',
      status: 'running'
    })
    .select()
    .single();

  if (historyError || !historyEntry) {
    console.error('Failed to create monitoring history entry:', historyError);
    return errorResponse('Failed to initialize monitoring', 500);
  }

  try {
    console.log('Starting RSS sources monitoring scan');

    // Fetch all active RSS sources (both 'rss' and 'url_feed' types)
    const { data: rssSources, error: sourcesError } = await supabaseClient
      .from('sources')
      .select('*')
      .in('type', ['rss', 'url_feed'])
      .eq('status', 'active');

    if (sourcesError) {
      console.error('Error fetching RSS sources:', sourcesError);
      throw new Error(`Failed to fetch RSS sources: ${sourcesError.message}`);
    }

    if (!rssSources || rssSources.length === 0) {
      console.log('No active RSS sources found');
      await supabaseClient
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: 0,
          signals_created: 0
        })
        .eq('id', historyEntry.id);

      return successResponse({ 
        success: true, 
        message: 'No RSS sources configured',
        sources_scanned: 0,
        signals_created: 0
      });
    }

    // Fetch all clients
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('*');

    if (clientsError) {
      console.error('Error fetching clients:', clientsError);
      throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    let totalSignals = 0;
    let totalItems = 0;
    const scannedSourceNames: string[] = [];

    // Process each RSS source
    for (const source of rssSources) {
      try {
        // Access the config column (not config_json)
        const feedUrl = source.config?.feed_url || source.config?.url;
        
        if (!feedUrl) {
          // Skip sources without URLs - don't add to scanned list
          console.log(`Skipping ${source.name}: No URL configured`);
          continue;
        }

        scannedSourceNames.push(source.name);
        console.log(`Fetching RSS feed: ${source.name} from ${feedUrl}`);
        
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' },
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });

        if (!response.ok) {
          const errorMsg = `${response.status} ${response.statusText}`;
          console.error(`Failed to fetch ${source.name}: ${errorMsg}`);
          
          // Update source with error status
          await supabaseClient
            .from('sources')
            .update({ 
              error_message: errorMsg,
              updated_at: new Date().toISOString()
            })
            .eq('id', source.id);
          
          continue;
        }

        const xmlText = await response.text();
        const items = parseRSS(xmlText);
        totalItems += items.length;

        console.log(`Found ${items.length} items in ${source.name}`);
        
        // Clear any previous error on successful fetch
        await supabaseClient
          .from('sources')
          .update({ 
            error_message: null,
            last_ingested_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', source.id);

        // Process each RSS item - ingest for AI analysis
        for (const item of items.slice(0, 10)) {
          try {
            // Check if this URL has already been ingested to prevent duplicates
            const { data: existingDoc } = await supabaseClient
              .from('ingested_documents')
              .select('id')
              .eq('metadata->>url', item.link)
              .single();

            if (existingDoc) {
              console.log(`Skipping already ingested item: ${item.title}`);
              continue;
            }

            const content = `${item.title}\n\n${item.description}`;
            
            // Ingest document for AI to analyze relevance
            const { data: insertedDoc, error: ingestError } = await supabaseClient
              .from('ingested_documents')
              .insert({
                title: item.title,
                raw_text: content,
                source_id: source.id,
                source_url: item.link || null,
                metadata: {
                  url: item.link,
                  source_type: 'rss',
                  source_name: source.name,
                  published_date: item.pubDate
                },
                processing_status: 'pending'
              })
              .select()
              .single();

            if (!ingestError && insertedDoc) {
              totalSignals++;
              
              // Trigger AI processing with correct documentId parameter
              supabaseClient.functions.invoke('process-intelligence-document', {
                body: { documentId: insertedDoc.id }
              }).catch(err => console.error('Failed to trigger processing:', err));
            }
          } catch (error) {
            console.error(`Error ingesting RSS item:`, error);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Error processing RSS source ${source.name}:`, error);
        
        // Update source with error message
        await supabaseClient
          .from('sources')
          .update({ 
            error_message: errorMsg.slice(0, 500), // Limit error message length
            updated_at: new Date().toISOString()
          })
          .eq('id', source.id);
      }
    }

    // Update monitoring history
    await supabaseClient
      .from('monitoring_history')
      .update({
        status: 'completed',
        scan_completed_at: new Date().toISOString(),
        items_scanned: totalItems,
        signals_created: totalSignals,
        scan_metadata: {
          sources: scannedSourceNames,
          source_count: rssSources.length
        }
      })
      .eq('id', historyEntry.id);

    console.log(`RSS monitoring completed. Scanned ${totalItems} items, created ${totalSignals} signals`);

    return successResponse({
      success: true,
      sources_scanned: rssSources.length,
      items_scanned: totalItems,
      signals_created: totalSignals
    });

  } catch (error) {
    console.error('RSS monitoring error:', error);
    
    // Provide detailed error message
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('Error stack:', error.stack);
    } else {
      errorMessage = String(error);
    }
    
    // Update monitoring history with error
    await supabaseClient
      .from('monitoring_history')
      .update({
        status: 'failed',
        scan_completed_at: new Date().toISOString(),
        error_message: errorMessage
      })
      .eq('id', historyEntry.id);

    return errorResponse(errorMessage, 500);
  }
});
