import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
        searchQueries.push(...client.monitoring_keywords.slice(0, 3));
      }
    }

    // Add general security topics
    searchQueries.push('security breach', 'cyber attack', 'ransomware', 'data leak');

    // Use Google News RSS feed with client-specific queries
    for (const query of searchQueries.slice(0, 10)) {
      try {
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1d&hl=en-US&gl=US&ceid=US:en`;
        const response = await fetch(feedUrl);
        if (!response.ok) continue;

        const xmlText = await response.text();
        const items = xmlText.match(/<item>(.*?)<\/item>/gs) || [];
        
        for (const item of items.slice(0, 3)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);

          if (!titleMatch || !descMatch) continue;

          const title = titleMatch[1];
          const description = descMatch[1];
          const link = linkMatch ? linkMatch[1] : '';

          try {
            // Ingest document for AI analysis
            const { error: ingestError } = await supabase
              .from('ingested_documents')
              .insert({
                title: title,
                raw_text: `${title}\n\n${description}`,
                metadata: {
                  url: link,
                  source_type: 'news',
                  source_name: 'Google News',
                  search_query: query
                },
                processing_status: 'pending'
              });

            if (!ingestError) {
              documentsIngested++;
              
              // Trigger AI processing in background
              supabase.functions.invoke('process-intelligence-document', {
                body: { document_id: null, content: `${title}\n\n${description}`, metadata: { url: link } }
              }).catch(err => console.error('Failed to trigger processing:', err));
            }
          } catch (error) {
            console.error(`Error ingesting news item:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching news for query "${query}":`, error);
      }
    }

    console.log(`News monitoring complete. Ingested ${documentsIngested} documents for AI analysis.`);

    // Update monitoring history on success
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          signals_created: documentsIngested,
          scan_metadata: { 
            sources: ['News API', 'Google News'],
            clients_scanned: clients?.length || 0
          }
        })
        .eq('id', historyEntry.id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        clients_scanned: clients?.length || 0,
          signals_created: documentsIngested,
        source: 'security-news'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in news monitoring:', error);
    
    // Update monitoring history on error
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
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
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
