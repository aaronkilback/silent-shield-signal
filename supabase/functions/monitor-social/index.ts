import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Security keywords to monitor
const SECURITY_KEYWORDS = [
  'data breach', 'hack', 'ransomware', 'malware', 'vulnerability',
  'exploit', 'zero-day', 'phishing', 'ddos', 'cyber attack'
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

    console.log('Starting social media monitoring scan...');

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor Reddit via RSS (public, no API key needed)
    const subreddits = ['cybersecurity', 'netsec', 'InfoSecNews'];
    
    for (const subreddit of subreddits) {
      try {
        const response = await fetch(
          `https://www.reddit.com/r/${subreddit}/new.json?limit=10`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; SOCBot/1.0)'
            }
          }
        );

        if (!response.ok) continue;

        const data = await response.json();
        const posts = data.data?.children || [];

        for (const post of posts.slice(0, 5)) {
          const title = post.data.title.toLowerCase();
          const selftext = post.data.selftext?.toLowerCase() || '';
          const combinedText = `${title} ${selftext}`;

          // Check if security-related
          const isSecurityRelated = SECURITY_KEYWORDS.some(keyword => 
            combinedText.includes(keyword)
          );

          if (!isSecurityRelated) continue;

          // Determine severity based on keywords
          const severity = combinedText.includes('breach') || combinedText.includes('ransomware') 
            ? 'high' 
            : combinedText.includes('vulnerability') 
            ? 'medium' 
            : 'low';

          // Create signals for relevant clients
          for (const client of clients || []) {
            try {
              // Check if relevant to client's name, organization, or industry
              const clientName = client.name?.toLowerCase() || '';
              const clientOrg = client.organization?.toLowerCase() || '';
              const clientIndustry = client.industry?.toLowerCase() || '';
              
              const isRelevant = 
                (clientName && combinedText.includes(clientName)) ||
                (clientOrg && combinedText.includes(clientOrg)) ||
                (clientIndustry && combinedText.includes(clientIndustry));

              if (isRelevant) {
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    source_key: 'social-monitor',
                    event: 'Social Media Threat Intel',
                    text: `Reddit r/${subreddit}: ${post.data.title}`,
                    location: 'Social Media',
                    severity: severity,
                    category: 'threat-intelligence',
                    normalized_text: post.data.title,
                    entity_tags: ['reddit', 'social-media', 'threat-intel'],
                    confidence: 0.75,
                    raw_json: {
                      source: 'reddit',
                      subreddit: subreddit,
                      url: `https://reddit.com${post.data.permalink}`,
                      author: post.data.author,
                      created: post.data.created_utc,
                      score: post.data.score
                    },
                    client_id: client.id
                  });

                if (!signalError) {
                  signalsCreated++;
                  console.log(`Created social signal for ${client.name}`);
                }
                
                // Limit to one signal per client per scan
                break;
              }
            } catch (error) {
              console.error(`Error processing for ${client.name}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching r/${subreddit}:`, error);
      }
    }

    console.log(`Social media monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'social-media'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in social media monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
