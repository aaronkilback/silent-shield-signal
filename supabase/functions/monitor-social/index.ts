import { createClient } from "npm:@supabase/supabase-js@2";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

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

// Activist/Environmental keywords for reputational monitoring
const ACTIVIST_KEYWORDS = [
  'protest', 'campaign', 'boycott', 'divestment', 'divest', 'activism',
  'climate', 'fossil fuel', 'oil spill', 'environmental', 'indigenous',
  'stand.earth', 'stand', 'greenpeace', 'extinction rebellion', '350.org',
  'pipeline protest', 'blockade', 'occupation', 'lawsuit', 'litigation',
  // Visual propaganda & viral content (avoid broad standalone triggers)
  'flaring', 'viral', 'expose', 'footage', 'documentary',
  'instagram', 'tiktok', 'youtube', 'social media campaign',
  // Activist hashtags
  'stoppetrochemical', 'protecttheclimate', 'fossilfree', 'keepitintheground',
  'noLNG', 'nopipeline', 'climatejustice', 'decolonize',
  // Indigenous rights
  'landback', 'indigenous rights', 'treaty rights', 'unceded territory',
  'first nations', 'reconciliation'
];

// Physical threat keywords for sabotage/infrastructure threats
const PHYSICAL_THREAT_KEYWORDS = [
  'sabotage', 'tree-spiking', 'tree spike', 'infrastructure attack',
  'valve turner', 'monkey wrench', 'direct action', 'occupation',
  'lock down', 'lockdown', 'chain', 'tripod', 'blockade tactics',
  'equipment damage', 'trespassing', 'illegal entry', 'security breach'
];

// Deal/Partnership keywords that trigger activist responses
const DEAL_KEYWORDS = [
  'acquisition', 'merger', 'partnership', 'supply deal', 'contract',
  'mou', 'agreement', 'offtake', 'LNG deal', 'pipeline deal',
  'joint venture', 'investment', 'financing', 'expansion'
];

// Industry-specific threat keywords
const INDUSTRY_THREATS: Record<string, string[]> = {
  'energy': ['scada', 'ics', 'pipeline', 'grid', 'utility', 'oil', 'gas', 'refinery'],
  'finance': ['banking', 'financial', 'payment', 'fraud', 'atm', 'swift'],
  'healthcare': ['hospital', 'medical', 'patient', 'hipaa', 'healthcare'],
  'retail': ['pos', 'e-commerce', 'payment card', 'retail'],
  'manufacturing': ['factory', 'production', 'supply chain', 'industrial']
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesKeyword(text: string, keyword: string): boolean {
  const t = text.toLowerCase();
  const k = keyword.toLowerCase().trim();
  if (!k) return false;

  // Multi-word phrases (and anything with punctuation) stay as substring matches.
  if (k.includes(' ') || /[^a-z0-9]/i.test(k)) {
    return t.includes(k);
  }

  // Short acronyms like "ics" should never match inside other words (e.g., "graph-ICS").
  const needsWordBoundary = k.length <= 3 || k === 'ics';
  if (!needsWordBoundary) return t.includes(k);

  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`, 'i');
  return re.test(t);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: historyEntry } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Social Media Monitoring',
      status: 'running'
    })
    .select()
    .single();

  try {
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
      // Cybersecurity
      'cybersecurity', 'netsec', 'InfoSecNews', 'blueteamsec',
      'threatintel', 'ReverseEngineering', 'pwned', 'privacy',
      // Environmental/Activism
      'climate', 'environment', 'ClimateActionPlan', 'energy',
      'climate_science', 'fossilfuels', 'ClimateOffensive'
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

          // Check if security-related, activist-related, physical threat, or deal-related
          const isSecurityRelated = SECURITY_KEYWORDS.some((keyword) =>
            includesKeyword(combinedText, keyword)
          );
          
          const isActivistRelated = ACTIVIST_KEYWORDS.some((keyword) =>
            includesKeyword(combinedText, keyword)
          );
          
          const isPhysicalThreat = PHYSICAL_THREAT_KEYWORDS.some((keyword) =>
            includesKeyword(combinedText, keyword)
          );
          
          const isDealRelated = DEAL_KEYWORDS.some((keyword) =>
            includesKeyword(combinedText, keyword)
          );

          if (!isSecurityRelated && !isActivistRelated && !isPhysicalThreat && !isDealRelated) continue;

          // Determine category and severity
          let category = 'threat-intelligence';
          let severity = 'low';
          
          if (isPhysicalThreat) {
            category = 'physical-security';
            severity = combinedText.includes('sabotage') || combinedText.includes('tree-spik') || combinedText.includes('equipment damage')
              ? 'critical'
              : combinedText.includes('blockade') || combinedText.includes('occupation')
              ? 'high'
              : 'medium';
          } else if (isActivistRelated) {
            category = 'reputational-risk';
            // Viral visual content is high severity
            if (combinedText.includes('viral') || combinedText.includes('flaring') || combinedText.includes('footage')) {
              severity = 'high';
            } else if (combinedText.includes('lawsuit') || combinedText.includes('blockade')) {
              severity = 'high';
            } else if (combinedText.includes('protest') || combinedText.includes('campaign')) {
              severity = 'medium';
            } else {
              severity = 'low';
            }
          } else if (isDealRelated) {
            category = 'reputational-risk';
            severity = 'medium'; // Deals can trigger activist responses
          } else if (isSecurityRelated) {
            category = 'threat-intelligence';
            severity = combinedText.includes('breach') || combinedText.includes('ransomware') 
              ? 'critical' 
              : combinedText.includes('vulnerability') || combinedText.includes('exploit')
              ? 'high'
              : 'medium';
          }

          // Create signals for relevant clients
          for (const client of clients || []) {
            try {
              // Enhanced name matching - check for partial matches and common variations
              const clientNameLower = client.name?.toLowerCase() || '';
              const clientOrgLower = client.organization?.toLowerCase() || '';
              
              // Split client name into words for partial matching (e.g., "Petronas" matches "Petronas Canada")
              const clientNameWords = clientNameLower.split(' ').filter((w: string) => w.length > 3);
              const hasNameMatch = clientNameWords.some((word: string) => combinedText.includes(word)) ||
                combinedText.includes(clientNameLower) ||
                (clientOrgLower && combinedText.includes(clientOrgLower));
              
              const hasIndustryMatch = client.industry && INDUSTRY_THREATS[client.industry.toLowerCase()]?.some(
                (term: string) => includesKeyword(combinedText, term)
              );
              
              const isRelevant = hasNameMatch || hasIndustryMatch;

              if (isRelevant) {
                const entityTags = ['reddit', 'social-media'];
                if (category === 'physical-security') {
                  entityTags.push('sabotage', 'infrastructure-threat', 'physical');
                } else if (category === 'reputational-risk') {
                  entityTags.push('activism', 'environmental', 'reputational');
                  if (combinedText.includes('viral') || combinedText.includes('video')) {
                    entityTags.push('visual-propaganda');
                  }
                } else {
                  entityTags.push('threat-intel');
                }
                
                // Boost confidence if client name directly mentioned
                const confidence = hasNameMatch ? 0.90 : 0.70;
                
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    normalized_text: post.data.title,
                    location: 'Social Media',
                    severity: severity,
                    category: category,
                    entity_tags: entityTags,
                    confidence: confidence,
                    raw_json: {
                      source: 'reddit',
                      subreddit: subreddit,
                      url: `https://reddit.com${post.data.permalink}`,
                      author: post.data.author,
                      created: post.data.created_utc,
                      score: post.data.score,
                      type: category,
                      matched_categories: [
                        ...(isPhysicalThreat ? ['physical-threat'] : []),
                        ...(isActivistRelated ? ['activist'] : []),
                        ...(isDealRelated ? ['deal'] : []),
                        ...(isSecurityRelated ? ['security'] : [])
                      ]
                    },
                    client_id: client.id,
                    status: 'new'
                  });

                if (!signalError) {
                  signalsCreated++;
                  console.log(`Created social signal for ${client.name}`);
                  
                  // Correlate entities using shared helper
                  await correlateSignalEntities({
                    supabase,
                    signalText: post.data.title,
                    clientId: client.id,
                    additionalContext: selftext || ''
                  });
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
            
            // Check if security-related, activist-related, physical threat, or deal-related
            const isSecurityRelated = SECURITY_KEYWORDS.some((keyword) =>
              includesKeyword(title, keyword)
            );
            
            const isActivistRelated = ACTIVIST_KEYWORDS.some((keyword) =>
              includesKeyword(title, keyword)
            );
            
            const isPhysicalThreat = PHYSICAL_THREAT_KEYWORDS.some((keyword) =>
              includesKeyword(title, keyword)
            );
            
            const isDealRelated = DEAL_KEYWORDS.some((keyword) =>
              includesKeyword(title, keyword)
            );
            
            if (!isSecurityRelated && !isActivistRelated && !isPhysicalThreat && !isDealRelated) continue;
            
            // Determine category and severity
            let category = 'threat-intelligence';
            let severity = 'low';
            
            if (isPhysicalThreat) {
              category = 'physical-security';
              severity = title.includes('sabotage') || title.includes('tree-spik') 
                ? 'critical'
                : title.includes('blockade') || title.includes('occupation')
                ? 'high'
                : 'medium';
            } else if (isActivistRelated) {
              category = 'reputational-risk';
              if (title.includes('viral') || title.includes('flaring')) {
                severity = 'high';
              } else if (title.includes('lawsuit') || title.includes('blockade')) {
                severity = 'high';
              } else if (title.includes('protest') || title.includes('campaign')) {
                severity = 'medium';
              } else {
                severity = 'low';
              }
            } else if (isDealRelated) {
              category = 'reputational-risk';
              severity = 'medium';
            } else if (isSecurityRelated) {
              severity = title.includes('breach') || title.includes('ransomware') 
                ? 'critical' 
                : title.includes('vulnerability') || title.includes('exploit')
                ? 'high'
                : 'medium';
            }
            
            // Check relevance to clients with enhanced matching
            for (const client of clients || []) {
              const clientNameLower = client.name?.toLowerCase() || '';
              const clientOrgLower = client.organization?.toLowerCase() || '';
              
              const clientNameWords = clientNameLower.split(' ').filter((w: string) => w.length > 3);
              const hasNameMatch = clientNameWords.some((word: string) => title.includes(word)) ||
                title.includes(clientNameLower) ||
                (clientOrgLower && title.includes(clientOrgLower));
              
              const hasIndustryMatch = client.industry && INDUSTRY_THREATS[client.industry.toLowerCase()]?.some(
                (term: string) => includesKeyword(title, term)
              );
              
              if (hasNameMatch || hasIndustryMatch) {
                const entityTags = ['hacker-news', 'social-media'];
                if (category === 'physical-security') {
                  entityTags.push('sabotage', 'infrastructure-threat');
                } else if (category === 'reputational-risk') {
                  entityTags.push('activism', 'environmental', 'reputational');
                } else {
                  entityTags.push('threat-intel');
                }
                
                const confidence = hasNameMatch ? 0.90 : 0.70;
                
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    normalized_text: story.title,
                    location: 'Hacker News',
                    severity: severity,
                    category: category,
                    entity_tags: entityTags,
                    confidence: confidence,
                    raw_json: {
                      source: 'hackernews',
                      url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
                      hn_id: story.id,
                      author: story.by,
                      score: story.score,
                      comments: story.descendants,
                      type: category,
                      matched_categories: [
                        ...(isPhysicalThreat ? ['physical-threat'] : []),
                        ...(isActivistRelated ? ['activist'] : []),
                        ...(isDealRelated ? ['deal'] : []),
                        ...(isSecurityRelated ? ['security'] : [])
                      ]
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

    // === TWITTER/X MONITORING (via scraping) ===
    // Using multiple nitter instances with robust fallback
    const nitterInstances = [
      'https://nitter.poast.org',
      'https://nitter.privacydev.net',
      'https://nitter.net',
      'https://nitter.1d4.us',
      'https://nitter.kavin.rocks'
    ];
    
    const twitterKeywords = [
      ...SECURITY_KEYWORDS.slice(0, 5), // More security keywords
      ...ACTIVIST_KEYWORDS.slice(0, 3),  // More activist keywords
      'data breach',
      'scandal'
    ];

    let twitterSuccessCount = 0;
    let twitterFailCount = 0;

    for (const keyword of twitterKeywords) {
      // Add delay between keyword searches
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
      
      const searchQuery = encodeURIComponent(keyword);
      let response = null;
      let successfulInstance = null;
      let html = null;
      
      // Try each nitter instance until one works
      for (const nitterUrl of nitterInstances) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          
          response = await fetch(
            `${nitterUrl}/search?f=tweets&q=${searchQuery}&since=&until=&near=`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              signal: controller.signal
            }
          ).finally(() => clearTimeout(timeout));

          if (response.ok) {
            html = await response.text();
            successfulInstance = nitterUrl;
            console.log(`Twitter search successful via ${nitterUrl} for "${keyword}"`);
            twitterSuccessCount++;
            break;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.log(`Failed to reach ${nitterUrl}: ${errorMessage}`);
          continue;
        }
      }
      
      if (!html || !successfulInstance) {
        console.log(`Twitter scrape failed for "${keyword}": all ${nitterInstances.length} instances failed`);
        twitterFailCount++;
        continue;
      }
      
      try {
        // Parse tweets from HTML (nitter has clean structure)
        const tweetMatches = html.matchAll(/<div class="tweet-content[^"]*"[^>]*>(.*?)<\/div>/gs);
        const tweets: { content: string; link: string }[] = [];
        
        for (const match of Array.from(tweetMatches).slice(0, 8)) { // Get more tweets
          const content = match[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[^;]+;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (content.length > 15) { // Lower minimum content length
            tweets.push({
              content,
              link: `https://twitter.com/search?q=${searchQuery}`
            });
          }
        }

        console.log(`Found ${tweets.length} tweets for "${keyword}"`);

        // Match tweets against clients with more lenient matching
        for (const tweet of tweets) {
          for (const client of clients || []) {
            const clientName = client.name.toLowerCase();
            const clientWords = clientName.split(' ');
            const tweetLower = tweet.content.toLowerCase();
            
            // More flexible name matching
            const mentionsClient = tweetLower.includes(clientName) || 
              clientWords.some((word: string) => word.length > 3 && tweetLower.includes(word));
            
            const industryMatch = client.industry && 
              INDUSTRY_THREATS[client.industry.toLowerCase()]?.some(term => 
                tweetLower.includes(term.toLowerCase())
              );

            // Lower threshold: create signal if client mentioned OR industry match with keyword
            if (mentionsClient || industryMatch) {
              let category = 'social_media';
              let severity = 'low';
              
              if (SECURITY_KEYWORDS.some(kw => tweetLower.includes(kw.toLowerCase()))) {
                category = 'cybersecurity';
                severity = mentionsClient ? 'medium' : 'low'; // Adjust based on direct mention
              } else if (ACTIVIST_KEYWORDS.some(kw => tweetLower.includes(kw.toLowerCase()))) {
                category = 'reputation';
                severity = mentionsClient ? 'medium' : 'low';
              } else if (PHYSICAL_THREAT_KEYWORDS.some(kw => tweetLower.includes(kw.toLowerCase()))) {
                category = 'physical';
                severity = mentionsClient ? 'high' : 'medium';
              }

              const signalText = `Twitter: ${tweet.content.substring(0, 250)}`;
              
              const { error: signalError } = await supabase
                .from('signals')
                .insert({
                  client_id: client.id,
                  normalized_text: signalText,
                  category,
                  severity,
                  location: 'Twitter/X',
                  raw_json: {
                    platform: 'twitter',
                    keyword,
                    link: tweet.link,
                    content: tweet.content,
                    nitter_instance: successfulInstance
                  },
                  status: 'new',
                  confidence: mentionsClient ? 0.75 : 0.45 // Adjust confidence based on match type
                });

              if (!signalError) {
                signalsCreated++;
                console.log(`Created Twitter signal for ${client.name}: ${category} (${severity})`);
              }
            }
          }
        }

        // Rate limiting between searches
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Twitter scrape timeout for: ${keyword}`);
        } else {
          console.error(`Error scraping Twitter for "${keyword}":`, error);
        }
        twitterFailCount++;
      }
    }

    console.log(`Twitter monitoring: ${twitterSuccessCount} successful, ${twitterFailCount} failed searches`);
    console.log(`Social media monitoring complete. Created ${signalsCreated} signals.`);

    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: clients?.length || 0,
          signals_created: signalsCreated,
          scan_metadata: {
            sources: ['Reddit', 'Twitter/X', 'Hacktivist Forums'],
            platforms: ['Reddit (10 subreddits)', 'Twitter/X (via Nitter)', 'Anonymous Forums'],
            clients_monitored: clients?.map(c => c.name) || []
          }
        })
        .eq('id', historyEntry.id);
    }

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
    
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'failed',
          scan_completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', historyEntry.id);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
