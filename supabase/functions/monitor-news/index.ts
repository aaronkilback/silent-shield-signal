import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting security news monitoring scan...');

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry');

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    // Use Google News RSS feed for cybersecurity news
    const rssFeeds = [
      'https://news.google.com/rss/search?q=cybersecurity+breach+OR+hack+when:1d&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=ransomware+attack+when:1d&hl=en-US&gl=US&ceid=US:en'
    ];

    for (const feedUrl of rssFeeds) {
      try {
        const response = await fetch(feedUrl);
        if (!response.ok) continue;

        const xmlText = await response.text();
        
        // Simple XML parsing for RSS items
        const items = xmlText.match(/<item>(.*?)<\/item>/gs) || [];
        
        for (const item of items.slice(0, 5)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);
          const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

          if (!titleMatch || !descMatch) continue;

          const title = titleMatch[1];
          const description = descMatch[1];
          const link = linkMatch ? linkMatch[1] : '';
          const pubDate = pubDateMatch ? pubDateMatch[1] : new Date().toISOString();

          // Check if news is security-related
          const text = `${title} ${description}`.toLowerCase();
          const isSecurityRelated = SECURITY_KEYWORDS.some(keyword => text.includes(keyword));

          if (!isSecurityRelated) continue;

          // Determine severity based on keywords
          const severity = text.includes('breach') || text.includes('ransomware') ? 'high' :
                          text.includes('vulnerability') || text.includes('exploit') ? 'medium' : 'low';

          // Create signal for relevant clients
          for (const client of clients || []) {
            try {
              // Check if news is relevant to client's industry
              if (client.industry && text.includes(client.industry.toLowerCase())) {
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    source_key: 'security-news-monitor',
                    event: 'Security News Alert',
                    text: `${title}\n\n${description}`,
                    location: 'Global',
                    severity: severity,
                    category: 'news',
                    normalized_text: title,
                    entity_tags: ['news', 'security', 'industry-specific'],
                    confidence: 0.80,
                    raw_json: {
                      title,
                      description,
                      link,
                      published: pubDate,
                      source: 'Google News'
                    },
                    client_id: client.id
                  });

                if (!signalError) {
                  signalsCreated++;
                  console.log(`Created news signal for ${client.name}: ${title.substring(0, 50)}`);
                }
              }
            } catch (error) {
              console.error(`Error processing news for ${client.name}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching RSS feed ${feedUrl}:`, error);
      }
    }

    console.log(`News monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'security-news'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in news monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
