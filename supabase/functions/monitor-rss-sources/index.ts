import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Create monitoring history entry
  const { data: historyEntry } = await supabaseClient
    .from('monitoring_history')
    .insert({
      source_name: 'RSS Sources',
      status: 'running'
    })
    .select()
    .single();

  try {
    console.log('Starting RSS sources monitoring scan');

    // Fetch all active RSS sources
    const { data: rssSources, error: sourcesError } = await supabaseClient
      .from('sources')
      .select('*')
      .eq('type', 'rss')
      .eq('is_active', true);

    if (sourcesError) throw sourcesError;

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

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No RSS sources configured',
        sources_scanned: 0,
        signals_created: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all clients
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('*');

    if (clientsError) throw clientsError;

    let totalSignals = 0;
    let totalItems = 0;
    const scannedSourceNames: string[] = [];

    // Process each RSS source
    for (const source of rssSources) {
      scannedSourceNames.push(source.name);
      try {
        const feedUrl = source.config_json?.url || source.config_json?.feed_url;
        
        if (!feedUrl) {
          console.log(`No URL configured for source: ${source.name}`);
          continue;
        }

        console.log(`Fetching RSS feed: ${source.name} from ${feedUrl}`);
        
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' }
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${source.name}: ${response.status}`);
          continue;
        }

        const xmlText = await response.text();
        const items = parseRSS(xmlText);
        totalItems += items.length;

        console.log(`Found ${items.length} items in ${source.name}`);

        // Process each RSS item
        for (const item of items.slice(0, 20)) { // Limit to 20 most recent items
          for (const client of clients) {
            // Check if content matches client keywords or locations
            const content = `${item.title} ${item.description}`.toLowerCase();
            let isRelevant = false;

            // Check monitoring keywords
            if (client.monitoring_keywords) {
              for (const keyword of client.monitoring_keywords) {
                if (content.includes(keyword.toLowerCase())) {
                  isRelevant = true;
                  break;
                }
              }
            }

            // Check locations
            if (!isRelevant && client.locations) {
              for (const location of client.locations) {
                if (content.includes(location.toLowerCase())) {
                  isRelevant = true;
                  break;
                }
              }
            }

            // If no keywords/locations, make it relevant for all clients
            if (!client.monitoring_keywords && !client.locations) {
              isRelevant = true;
            }

            if (isRelevant) {
              // Determine category and severity based on content
              let category = 'threat-intelligence';
              let severity = 'medium';

              if (content.includes('fire') || content.includes('wildfire')) {
                category = 'threat-intelligence';
                severity = 'high';
              } else if (content.includes('alert') || content.includes('warning')) {
                category = 'threat-intelligence';
                severity = 'high';
              } else if (content.includes('closure') || content.includes('emergency')) {
                category = 'threat-intelligence';
                severity = 'critical';
              }

              const { error: signalError } = await supabaseClient
                .from('signals')
                .insert({
                  source_id: source.id,
                  client_id: client.id,
                  category,
                  severity,
                  normalized_text: `${item.title}\n\n${item.description}`,
                  status: 'new',
                  raw_json: {
                    source_name: source.name,
                    title: item.title,
                    link: item.link,
                    published_date: item.pubDate
                  }
                });

              if (signalError) {
                console.error('Error creating signal:', signalError);
              } else {
                totalSignals++;
                
                await correlateSignalEntities({
                  supabase: supabaseClient,
                  signalText: `${item.title}\n\n${item.description}`,
                  clientId: client.id,
                  additionalContext: `Source: ${source.name}`
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing RSS source ${source.name}:`, error);
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

    return new Response(JSON.stringify({
      success: true,
      sources_scanned: rssSources.length,
      items_scanned: totalItems,
      signals_created: totalSignals
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('RSS monitoring error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (historyEntry) {
      await supabaseClient
        .from('monitoring_history')
        .update({
          status: 'failed',
          scan_completed_at: new Date().toISOString(),
          error_message: errorMessage
        })
        .eq('id', historyEntry.id);
    }

    return new Response(JSON.stringify({ 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
