import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { extractOGImage } from "../_shared/og-image.ts";
import { extractYouTubeTranscript } from "../_shared/youtube-transcript.ts";
import { enqueueJob } from "../_shared/queue.ts";

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
}

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
  const heartbeatAt = new Date().toISOString();
  const heartbeatMs = Date.now();

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
        
        // Reddit requires a descriptive User-Agent or returns 403
        const userAgent = feedUrl.includes('reddit.com')
          ? 'FortressAI/1.0 (OSINT security monitoring; automated)'
          : 'Mozilla/5.0 (compatible; FortressAI/1.0; OSINT Monitor)';
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': userAgent },
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
        const allItems = parseRSS(xmlText);
        // Only ingest items published within the last 7 days
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const items = allItems.filter((item) => {
          const ts = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
          return isNaN(ts) || ts >= cutoff; // keep if unparseable (default = now)
        });
        totalItems += items.length;

        console.log(`Found ${allItems.length} items in ${source.name}, ${items.length} within last 7 days`);
        
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

            let content = `${item.title}\n\n${item.description}`;
            let imageUrl: string | null = null;

            if (item.link && isYouTubeUrl(item.link)) {
              // For YouTube items: extract transcript instead of OG image
              const transcript = await extractYouTubeTranscript(item.link).catch(() => null);
              if (transcript) {
                content = `${item.title}\n\n${transcript}`;
                console.log(`Extracted YouTube transcript for: ${item.title} (${transcript.length} chars)`);
              }
            } else {
              // Extract OG image from article page (non-blocking)
              imageUrl = item.link ? await extractOGImage(item.link).catch(() => null) : null;
            }

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
                  source_type: item.link && isYouTubeUrl(item.link) ? 'youtube' : 'rss',
                  source_name: source.name,
                  published_date: item.pubDate,
                  image_url: imageUrl || undefined,
                },
                processing_status: 'pending'
              })
              .select()
              .single();

            if (!ingestError && insertedDoc) {
              totalSignals++;
              // Durable queue — was fire-and-forget invoke.
              enqueueJob(supabaseClient, {
                type: 'process-intelligence-document',
                payload: { documentId: insertedDoc.id },
                idempotencyKey: `process-intelligence-document:${insertedDoc.id}`,
              }).catch(err => console.error('Failed to enqueue processing:', err));
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

    try {
      await supabaseClient.from('cron_heartbeat').insert({
        job_name: 'monitor-rss-sources',
        started_at: heartbeatAt,
        completed_at: new Date().toISOString(),
        status: 'completed',
        duration_ms: Date.now() - heartbeatMs,
        result_summary: { signals_created: totalSignals, items_scanned: totalItems },
      });
    } catch (_) { /* non-fatal */ }

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
