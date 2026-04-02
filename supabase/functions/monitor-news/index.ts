import { createServiceClient, handleCors, successResponse, errorResponse, corsHeaders } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

// Security-related keywords to filter news
const SECURITY_KEYWORDS = [
  'breach', 'hack', 'cyber', 'ransomware', 'malware', 'vulnerability',
  'threat', 'attack', 'security', 'data leak', 'phishing', 'zero-day',
  'exploit', 'compromise', 'incident'
];

// Deal/Business keywords that can trigger reputational issues
const DEAL_KEYWORDS = [
  'acquisition', 'merger', 'partnership', 'supply deal', 'contract',
  'agreement', 'offtake', 'LNG', 'pipeline deal', 'joint venture',
  'investment', 'financing', 'expansion', 'MOU', 'signs deal'
];

// Reputational risk keywords
const REPUTATIONAL_KEYWORDS = [
  'lawsuit', 'protest', 'activist', 'opposition', 'controversy',
  'criticized', 'backlash', 'investigation', 'fine', 'penalty',
  'environmental', 'indigenous', 'climate', 'emissions', 'flaring'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Create monitoring history entry
    const { data: historyEntry, error: historyError } = await supabase
      .from('monitoring_history')
      .insert({
        source_name: 'News Monitor',
        status: 'running',
        scan_metadata: { sources: ['News API', 'Google News'] }
      })
      .select()
      .single();

    if (historyError) {
      console.error('Failed to create monitoring history:', historyError);
    }

    console.log('Starting security news monitoring scan...');

    // Fetch active news sources from database
    const { data: newsSources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .eq('status', 'active')
      .or('type.eq.api_feed,type.eq.rss')
      .contains('config', { monitor_type: 'news' });

    if (sourcesError) {
      console.error('Error fetching news sources:', sourcesError);
    }

    const activeSourcesCount = newsSources?.length || 0;
    console.log(`Found ${activeSourcesCount} active news sources in database`);

    // Update history with actual sources count
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          scan_metadata: { 
            sources_configured: activeSourcesCount,
            source_names: newsSources?.map(s => s.name) || []
          }
        })
        .eq('id', historyEntry.id);
    }

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry, monitoring_keywords');

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let documentsIngested = 0;
    let signalsCreated = 0;

    // Get client keywords for targeted searches
    const searchQueries: string[] = [];
    for (const client of clients || []) {
      if (client.monitoring_keywords && client.monitoring_keywords.length > 0) {
        searchQueries.push(...client.monitoring_keywords.slice(0, 5));
      }
      searchQueries.push(client.name);
    }

    // Add general security and business topics
    searchQueries.push(
      'security breach', 'cyber attack', 'ransomware', 'data leak',
      'environmental protest', 'corporate controversy', 'regulatory fine',
      'activist campaign', 'supply chain disruption'
    );

    // Use Google News RSS feed with client-specific queries
    for (const query of searchQueries.slice(0, 20)) {
      try {
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1d&hl=en-US&gl=US&ceid=US:en`;
        const response = await fetch(feedUrl);
        if (!response.ok) continue;

        const xmlText = await response.text();
        const items = xmlText.match(/<item>(.*?)<\/item>/gs) || [];
        
        for (const item of items.slice(0, 5)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);

          if (!titleMatch || !descMatch) continue;

          const title = titleMatch[1];
          const rawDescription = descMatch[1];
          // Strip HTML tags from RSS description
          const description = rawDescription.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const link = linkMatch ? linkMatch[1] : '';

          // Skip items with no meaningful content beyond the title
          if (description.length < 40) continue;

          const fullContent = `${title}\n\n${description}`.toLowerCase();

          try {
            // Check if content matches ANY client's keywords
            let matchedClient = null;
            let matchedKeywords: string[] = [];
            
            for (const client of clients || []) {
              if (fullContent.includes(client.name.toLowerCase())) {
                matchedClient = client;
                matchedKeywords.push(`client_name:${client.name}`);
                break;
              }
              
              if (client.monitoring_keywords && client.monitoring_keywords.length > 0) {
                const foundKeywords = client.monitoring_keywords.filter((keyword: string) => 
                  fullContent.includes(keyword.toLowerCase())
                );
                
                if (foundKeywords.length > 0) {
                  matchedClient = client;
                  matchedKeywords = foundKeywords;
                  console.log(`✓ KEYWORD MATCH for ${client.name}: ${foundKeywords.join(', ')}`);
                  break;
                }
              }
            }

            if (matchedClient) {
              const signalText = `${title}\n\n${description.slice(0, 1000)}`;

              // Route through ingest-signal for PECL classification, relevance gate, and dedup
              const ingestResult = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: signalText,
                  source_url: link || null,
                  client_id: matchedClient.id,
                  raw_json: {
                    source: 'google_news_rss',
                    source_url: link,
                    description,
                    search_query: query,
                    matched_keywords: matchedKeywords,
                    matched_client: matchedClient.name,
                  },
                },
              });

              if (ingestResult.error) {
                console.error(`ingest-signal error for "${title.substring(0, 50)}":`, ingestResult.error);
                continue;
              }

              const ingestData = ingestResult.data as any;
              const ingestStatus = ingestData?.status || 'unknown';

              if (ingestStatus === 'rejected' || ingestStatus === 'suppressed' || ingestStatus === 'filed_as_update') {
                console.log(`↳ ${ingestStatus}: ${title.substring(0, 50)}... (${ingestData?.reason || ingestData?.detail || ''})`);
                continue;
              }

              if (ingestData?.signal_id || ingestStatus === 'enqueued' || ingestStatus === 'critical_processed') {
                signalsCreated++;
                documentsIngested++;
                console.log(`✓ CREATED SIGNAL for ${matchedClient.name}: ${title.substring(0, 60)}... (matched: ${matchedKeywords.join(', ')})`);
              }
            } else {
              console.log(`- No keyword match for: ${title.substring(0, 60)}...`);
            }
          } catch (error) {
            console.error(`Error processing news item:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching news for query "${query}":`, error);
      }
    }

    console.log(`News monitoring complete. Created ${signalsCreated} immediate signals. Ingested ${documentsIngested} documents for AI analysis.`);

    // Update monitoring history on success
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          signals_created: signalsCreated + documentsIngested,
          scan_metadata: { 
            sources: ['News API', 'Google News'],
            clients_scanned: clients?.length || 0,
            immediate_signals: signalsCreated,
            documents_ingested: documentsIngested
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({ 
      success: true, 
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated + documentsIngested,
      source: 'security-news'
    });
  } catch (error) {
    console.error('Error in news monitoring:', error);
    
    const supabase = createServiceClient();
    
    try {
      const { data: failedEntry } = await supabase
        .from('monitoring_history')
        .select('id')
        .eq('source_name', 'News Monitor')
        .eq('status', 'running')
        .order('scan_started_at', { ascending: false })
        .limit(1)
        .single();

      if (failedEntry) {
        await supabase
          .from('monitoring_history')
          .update({
            status: 'failed',
            scan_completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', failedEntry.id);
      }
    } catch (updateError) {
      console.error('Failed to update monitoring history:', updateError);
    }
    
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
