import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

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
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

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

    // === TWITTER/X & SOCIAL MEDIA MONITORING (via Google Custom Search + Perplexity) ===
    // Nitter instances are all dead — replaced with Google CSE + Perplexity Sonar
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CSE_ID = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

    const socialSearchKeywords = [
      ...SECURITY_KEYWORDS.slice(0, 5),
      ...ACTIVIST_KEYWORDS.slice(0, 3),
      'data breach',
      'scandal'
    ];

    let socialSuccessCount = 0;
    let socialFailCount = 0;

    // --- Google Custom Search for Twitter/X content ---
    if (GOOGLE_API_KEY && GOOGLE_CSE_ID) {
      for (const keyword of socialSearchKeywords.slice(0, 6)) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1500));
          const query = encodeURIComponent(`site:x.com OR site:twitter.com ${keyword}`);
          const gResponse = await fetch(
            `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${query}&num=5&dateRestrict=d1`,
            { headers: { 'Accept': 'application/json' } }
          );

          if (!gResponse.ok) {
            console.log(`Google CSE failed for "${keyword}": ${gResponse.status}`);
            socialFailCount++;
            continue;
          }

          const gData = await gResponse.json();
          const items = gData.items || [];
          socialSuccessCount++;

          for (const item of items.slice(0, 3)) {
            const title = (item.title || '').toLowerCase();
            const snippet = (item.snippet || '').toLowerCase();
            const combinedText = `${title} ${snippet}`;

            for (const client of clients || []) {
              const clientNameLower = client.name?.toLowerCase() || '';
              const clientNameWords = clientNameLower.split(' ').filter((w: string) => w.length > 3);
              const hasNameMatch = clientNameWords.some((word: string) => combinedText.includes(word)) || combinedText.includes(clientNameLower);
              const hasIndustryMatch = client.industry && INDUSTRY_THREATS[client.industry.toLowerCase()]?.some(
                (term: string) => includesKeyword(combinedText, term)
              );

              if (hasNameMatch || hasIndustryMatch) {
                let category = 'social_media';
                let severity = 'low';
                if (SECURITY_KEYWORDS.some(kw => includesKeyword(combinedText, kw))) { category = 'cybersecurity'; severity = hasNameMatch ? 'medium' : 'low'; }
                else if (ACTIVIST_KEYWORDS.some(kw => includesKeyword(combinedText, kw))) { category = 'reputation'; severity = hasNameMatch ? 'medium' : 'low'; }
                else if (PHYSICAL_THREAT_KEYWORDS.some(kw => includesKeyword(combinedText, kw))) { category = 'physical'; severity = hasNameMatch ? 'high' : 'medium'; }

                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    client_id: client.id,
                    normalized_text: `Twitter/X: ${item.title?.substring(0, 250) || snippet.substring(0, 250)}`,
                    category,
                    severity,
                    location: 'Twitter/X',
                    raw_json: { platform: 'twitter', source: 'google_cse', keyword, url: item.link, snippet: item.snippet },
                    status: 'new',
                    confidence: hasNameMatch ? 0.80 : 0.55
                  });
                if (!signalError) { signalsCreated++; console.log(`Created Google CSE Twitter signal for ${client.name}`); }
                break;
              }
            }
          }
        } catch (error) {
          console.error(`Google CSE error for "${keyword}":`, error);
          socialFailCount++;
        }
      }
    } else {
      console.log('Google CSE not configured — skipping Twitter/X search via Google');
    }

    // --- Perplexity Sonar for broader social media intelligence ---
    if (PERPLEXITY_API_KEY) {
      for (const client of (clients || []).slice(0, 5)) {
        try {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const pQuery = `Recent social media posts, news, or public discussions about "${client.name}" related to security threats, protests, boycotts, data breaches, or incidents in the last 24 hours.`;
          
          const pResponse = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'sonar',
              messages: [{ role: 'user', content: pQuery }],
              max_tokens: 500,
            }),
          });

          if (!pResponse.ok) {
            console.log(`Perplexity search failed for ${client.name}: ${pResponse.status}`);
            socialFailCount++;
            continue;
          }

          const pData = await pResponse.json();
          const content = pData.choices?.[0]?.message?.content || '';
          socialSuccessCount++;

          // Only create signal if content indicates actual threats/mentions
          const contentLower = content.toLowerCase();
          const hasThreatContent = [
            ...SECURITY_KEYWORDS, ...ACTIVIST_KEYWORDS, ...PHYSICAL_THREAT_KEYWORDS
          ].some(kw => includesKeyword(contentLower, kw));

          if (hasThreatContent && content.length > 100 && !contentLower.includes('no recent') && !contentLower.includes('no specific')) {
            let category = 'social_media';
            let severity = 'low';
            if (SECURITY_KEYWORDS.some(kw => includesKeyword(contentLower, kw))) { category = 'cybersecurity'; severity = 'medium'; }
            else if (PHYSICAL_THREAT_KEYWORDS.some(kw => includesKeyword(contentLower, kw))) { category = 'physical'; severity = 'high'; }
            else if (ACTIVIST_KEYWORDS.some(kw => includesKeyword(contentLower, kw))) { category = 'reputation'; severity = 'medium'; }

            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: `Social Intelligence: ${content.substring(0, 300)}`,
                category,
                severity,
                location: 'Social Media (Multi-Platform)',
                raw_json: {
                  platform: 'perplexity_sonar',
                  source: 'multi_platform_search',
                  citations: pData.citations || [],
                  full_content: content.substring(0, 2000),
                },
                status: 'new',
                confidence: 0.70
              });
            if (!signalError) { signalsCreated++; console.log(`Created Perplexity social signal for ${client.name}`); }
          }
        } catch (error) {
          console.error(`Perplexity error for ${client.name}:`, error);
          socialFailCount++;
        }
      }
    } else {
      console.log('Perplexity API key not configured — skipping AI-powered social search');
    }

    console.log(`Social media monitoring: ${socialSuccessCount} successful, ${socialFailCount} failed searches`);
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
            sources: ['Reddit', 'Google CSE (Twitter/X)', 'Perplexity Sonar', 'Hacker News'],
            platforms: ['Reddit (14 subreddits)', 'Twitter/X (via Google CSE)', 'Multi-platform (via Perplexity)', 'Hacker News'],
            clients_monitored: clients?.map(c => c.name) || [],
            social_search_stats: { success: socialSuccessCount, failed: socialFailCount }
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: 'social-media'
    });

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

    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
