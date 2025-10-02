import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Security keywords to monitor
const SECURITY_KEYWORDS = [
  'data breach', 'hack', 'ransomware', 'malware', 'vulnerability',
  'exploit', 'zero-day', 'phishing', 'ddos', 'cyber attack', 'cyberattack',
  'backdoor', 'trojan', 'botnet', 'apt', 'threat actor', 'incident',
  'compromise', 'exfiltration', 'lateral movement', 'privilege escalation'
];

// Industry-specific threat keywords
const INDUSTRY_THREATS: Record<string, string[]> = {
  'energy': ['scada', 'ics', 'pipeline', 'grid', 'utility', 'oil', 'gas', 'refinery'],
  'finance': ['banking', 'financial', 'payment', 'fraud', 'atm', 'swift'],
  'healthcare': ['hospital', 'medical', 'patient', 'hipaa', 'healthcare'],
  'retail': ['pos', 'e-commerce', 'payment card', 'retail'],
  'manufacturing': ['factory', 'production', 'supply chain', 'industrial']
};

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

    // === REDDIT MONITORING ===
    const subreddits = [
      'cybersecurity', 'netsec', 'InfoSecNews', 'blueteamsec',
      'threatintel', 'ReverseEngineering', 'pwned', 'privacy'
    ];
    
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
              
              // Check for direct mention OR industry-specific threats
              const hasDirectMention = 
                (clientName && combinedText.includes(clientName)) ||
                (clientOrg && combinedText.includes(clientOrg));
              
              // Check for industry-relevant threats
              const industryKeywords = INDUSTRY_THREATS[clientIndustry] || [];
              const hasIndustryThreat = industryKeywords.some(keyword => 
                combinedText.includes(keyword)
              );

              const isRelevant = hasDirectMention || (hasIndustryThreat && clientIndustry);

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

    // === HACKER NEWS MONITORING ===
    try {
      const hnResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (hnResponse.ok) {
        const storyIds = await hnResponse.json();
        
        // Check top 30 stories
        for (const storyId of storyIds.slice(0, 30)) {
          try {
            const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`);
            if (!storyResponse.ok) continue;
            
            const story = await storyResponse.json();
            if (!story.title) continue;
            
            const title = story.title.toLowerCase();
            
            // Check if security-related
            const isSecurityRelated = SECURITY_KEYWORDS.some(keyword => 
              title.includes(keyword)
            );
            
            if (!isSecurityRelated) continue;
            
            const severity = title.includes('breach') || title.includes('ransomware') 
              ? 'high' 
              : title.includes('vulnerability') 
              ? 'medium' 
              : 'low';
            
            // Check relevance to clients
            for (const client of clients || []) {
              const clientName = client.name?.toLowerCase() || '';
              const clientOrg = client.organization?.toLowerCase() || '';
              const clientIndustry = client.industry?.toLowerCase() || '';
              
              const hasDirectMention = 
                (clientName && title.includes(clientName)) ||
                (clientOrg && title.includes(clientOrg));
              
              const industryKeywords = INDUSTRY_THREATS[clientIndustry] || [];
              const hasIndustryThreat = industryKeywords.some(keyword => 
                title.includes(keyword)
              );
              
              if (hasDirectMention || (hasIndustryThreat && clientIndustry)) {
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    normalized_text: story.title,
                    location: 'Hacker News',
                    severity: severity,
                    category: 'threat-intelligence',
                    entity_tags: ['hacker-news', 'social-media', 'threat-intel'],
                    confidence: 0.80,
                    raw_json: {
                      source: 'hackernews',
                      url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
                      hn_id: story.id,
                      author: story.by,
                      score: story.score,
                      comments: story.descendants
                    },
                    client_id: client.id,
                    status: 'new'
                  });
                
                if (!signalError) {
                  signalsCreated++;
                  console.log(`Created Hacker News signal for ${client.name}`);
                }
                break;
              }
            }
          } catch (error) {
            console.error(`Error fetching HN story ${storyId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error monitoring Hacker News:', error);
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
