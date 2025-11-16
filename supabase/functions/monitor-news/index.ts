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

    console.log('Starting security news monitoring scan...');

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry');

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    // Use Google News RSS feed for multiple categories
    const rssFeeds = [
      'https://news.google.com/rss/search?q=cybersecurity+breach+OR+hack+when:1d&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=ransomware+attack+when:1d&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=energy+deal+OR+LNG+OR+pipeline+when:1d&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=oil+gas+protest+OR+lawsuit+when:1d&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=petrochemical+acquisition+OR+merger+when:1d&hl=en-US&gl=US&ceid=US:en'
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

          // Check if news is security, deal, or reputational-related
          const text = `${title} ${description}`.toLowerCase();
          const isSecurityRelated = SECURITY_KEYWORDS.some(keyword => text.includes(keyword));
          const isDealRelated = DEAL_KEYWORDS.some(keyword => text.includes(keyword));
          const isReputationalRisk = REPUTATIONAL_KEYWORDS.some(keyword => text.includes(keyword));

          if (!isSecurityRelated && !isDealRelated && !isReputationalRisk) continue;

          // Determine category and severity
          let category = 'news';
          let severity = 'low';
          
          if (isSecurityRelated) {
            category = 'threat-intelligence';
            severity = text.includes('breach') || text.includes('ransomware') ? 'critical' :
                       text.includes('vulnerability') || text.includes('exploit') ? 'high' : 'medium';
          } else if (isDealRelated && isReputationalRisk) {
            // Deal + controversy = high reputational risk
            category = 'reputational-risk';
            severity = 'high';
          } else if (isReputationalRisk) {
            category = 'reputational-risk';
            severity = text.includes('lawsuit') || text.includes('investigation') ? 'high' : 'medium';
          } else if (isDealRelated) {
            category = 'business-intelligence';
            severity = 'medium';
          }

          // Create signal for relevant clients
          for (const client of clients || []) {
            try {
              // Enhanced relevance checking - name, industry, or deal mentions
              const clientNameLower = client.name.toLowerCase();
              const clientNameWords = clientNameLower.split(' ').filter((w: string) => w.length > 3);
              
              const hasNameMatch = clientNameWords.some((word: string) => text.includes(word)) || text.includes(clientNameLower);
              const hasIndustryMatch = client.industry && text.includes(client.industry.toLowerCase());
              
              if (hasNameMatch || hasIndustryMatch) {
                // Boost confidence if client name is directly mentioned
                const confidence = hasNameMatch ? 0.90 : 0.75;
                
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    source_id: null,
                    normalized_text: title,
                    category: category,
                    severity: severity,
                    location: 'Global',
                    confidence: confidence,
                    entity_tags: hasNameMatch ? ['news', category, 'client-mentioned'] : ['news', category, 'industry-relevant'],
                    raw_json: {
                      title,
                      description,
                      link,
                      published: pubDate,
                      source: 'Google News',
                      matched_keywords: [
                        ...(isSecurityRelated ? ['security'] : []),
                        ...(isDealRelated ? ['deal'] : []),
                        ...(isReputationalRisk ? ['reputational-risk'] : [])
                      ]
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
