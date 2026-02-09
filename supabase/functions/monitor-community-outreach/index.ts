import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Community Outreach Monitor
 * 
 * Scans local news, First Nations band sites, and government portals 
 * for community engagement opportunities in NE British Columbia.
 * Signals are categorized as 'community_outreach' for easy filtering.
 */

interface OutreachSource {
  name: string;
  type: 'rss' | 'google_search';
  url?: string;
  query?: string;
}

// NE BC community outreach sources
const RSS_SOURCES: OutreachSource[] = [
  // Local News - Fort St. John / Peace Region
  { name: 'Energetic City News', type: 'rss', url: 'https://www.energeticcity.ca/feed/' },
  { name: 'Alaska Highway News', type: 'rss', url: 'https://www.alaskahighwaynews.ca/rss' },
  { name: 'Peace Arch News', type: 'rss', url: 'https://www.peacearchnews.com/feed/' },
  // BC Government
  { name: 'BC Gov News', type: 'rss', url: 'https://news.gov.bc.ca/feed' },
];

// Google Search queries for community outreach
const OUTREACH_SEARCH_QUERIES = [
  // First Nations engagement
  '"First Nations" (consultation OR engagement OR meeting OR gathering) "Fort St. John" OR "northeast BC" OR "Peace River"',
  '(Treaty 8 OR "Blueberry River" OR "Doig River" OR "Halfway River" OR "Prophet River" OR "West Moberly") (meeting OR event OR consultation OR announcement)',
  // Community events & outreach
  '"Fort St. John" (community OR outreach OR "open house" OR "town hall" OR "public meeting" OR workshop)',
  '"northeast British Columbia" (engagement OR consultation OR "community event" OR reconciliation)',
  // Industry-community relations
  '(LNG OR pipeline OR "Coastal GasLink" OR PRGT) (community OR engagement OR benefit OR agreement OR consultation) "British Columbia"',
  // Local government & regional district
  '"Peace River Regional District" (meeting OR event OR announcement OR consultation)',
  '"City of Fort St. John" (event OR meeting OR engagement OR announcement)',
];

// Keywords that indicate community outreach relevance
const OUTREACH_KEYWORDS = [
  // Engagement
  'community engagement', 'public consultation', 'open house', 'town hall',
  'community meeting', 'stakeholder engagement', 'public hearing',
  // First Nations
  'first nations', 'indigenous', 'reconciliation', 'treaty', 'nation-to-nation',
  'duty to consult', 'indigenous rights', 'aboriginal', 'métis',
  'blueberry river', 'doig river', 'halfway river', 'prophet river', 'west moberly',
  'saulteau', 'mcleod lake', 'tsay keh dene', 'kwadacha',
  // Events & gatherings
  'gathering', 'ceremony', 'potlatch', 'cultural event', 'powwow',
  'workshop', 'conference', 'forum', 'summit', 'roundtable',
  // Community development
  'community benefit', 'impact benefit agreement', 'community investment',
  'scholarship', 'training program', 'employment opportunity',
  'community development', 'social responsibility', 'community fund',
  // Locations
  'fort st. john', 'fort st john', 'dawson creek', 'hudson\'s hope',
  'chetwynd', 'tumbler ridge', 'taylor bc', 'peace river', 'northeast bc',
  'charlie lake', 'pink mountain', 'wonowon',
];

// Anti-keywords: content with these is likely NOT outreach
const EXCLUDE_PATTERNS = [
  /\b(arrest|murder|assault|robbery|theft|arson)\b/i,
  /\b(accident|collision|crash|fatality)\b/i,
  /\b(wildfire|evacuation order)\b/i,
  // Obituaries & funeral notices
  /\b(obituar|funeral|memorial service|passed away|in loving memory|condolences|rest in peace)\b/i,
  // Job postings & recruitment
  /\b(salary|hourly wage|apply now|job posting|resume|cover letter|hiring|job openings?|career opportunities?)\b/i,
  /\$\d+\s*[-–]\s*\$\d+/i, // Salary ranges like $21 - $22
  // Generic institutional pages (not events)
  /\b(staff resources|work tools|content editor|pay stubs?|employee portal)\b/i,
];

// Domains that produce noise / irrelevant results
const EXCLUDED_DOMAINS = [
  'wikipedia.org', 'youtube.com', 'talent.com', 'indeed.com',
  'linkedin.com/jobs', 'tumblr.com', 'volcanodiscovery.com',
  'facebook.com/groups', 'pinterest.com', 'tiktok.com',
  'amazon.com', 'ebay.com', 'reddit.com',
  // Job boards & recruitment sites
  'experiencehub.ca', 'jobs.ca', 'workbc.ca', 'jobbank.gc.ca',
  'glassdoor.com', 'ziprecruiter.com', 'careerbuilder.com',
  // Obituary sites
  'shortenandryan.com', 'legacy.com', 'arbormemorial.ca',
  'dignitymemorial.com', 'remembering.ca',
  // Generic health/institutional portals
  'phsa.ca', 'interiorhealth.ca',
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
  const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

  // Create monitoring history entry
  const { data: historyEntry } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Community Outreach Monitor',
      status: 'running',
      scan_metadata: { region: 'NE British Columbia', focus: 'community_outreach' }
    })
    .select()
    .single();

  try {
    console.log('Starting community outreach monitoring for NE BC...');

    // Resolve Petronas Canada client (primary client for outreach)
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d')
      .single();

    const clientId = client?.id || null;
    console.log(`Target client: ${client?.name || 'None (general)'}`);

    let signalsCreated = 0;
    let itemsScanned = 0;
    const sourcesProcessed: string[] = [];

    // ═══════════════════════════════════════════════════
    // Phase 1: RSS Feeds from local news & government
    // ═══════════════════════════════════════════════════
    for (const source of RSS_SOURCES) {
      try {
        console.log(`Scanning RSS: ${source.name}...`);
        const response = await fetch(source.url!, {
          headers: { 'User-Agent': 'FORTRESS-Outreach-Monitor/1.0' }
        });

        if (!response.ok) {
          console.warn(`RSS fetch failed for ${source.name}: ${response.status}`);
          continue;
        }

        const xmlText = await response.text();
        const items = parseRSS(xmlText);
        itemsScanned += items.length;

        for (const item of items.slice(0, 15)) {
          const content = `${item.title} ${item.description}`.toLowerCase();
          const relevance = scoreOutreachRelevance(content);

          if (relevance.score >= 30) {
            const created = await createOutreachSignal(supabase, {
              clientId,
              source: source.name,
              title: item.title,
              description: item.description,
              url: item.link,
              publishedDate: item.pubDate,
              relevanceScore: relevance.score,
              relevanceReasons: relevance.reasons,
              outreachType: relevance.outreachType,
            });
            if (created) signalsCreated++;
          }
        }

        sourcesProcessed.push(source.name);
        // Rate limit between sources
        await delay(300);
      } catch (err) {
        console.error(`Error processing ${source.name}:`, err);
      }
    }

    // ═══════════════════════════════════════════════════
    // Phase 2: Google Custom Search for outreach content
    // ═══════════════════════════════════════════════════
    if (googleApiKey && googleEngineId) {
      console.log('Phase 2: Google Search for outreach opportunities...');

      for (const query of OUTREACH_SEARCH_QUERIES) {
        try {
          const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
          searchUrl.searchParams.set('key', googleApiKey);
          searchUrl.searchParams.set('cx', googleEngineId);
          searchUrl.searchParams.set('q', query);
          searchUrl.searchParams.set('num', '5');
          searchUrl.searchParams.set('dateRestrict', 'd7'); // Last 7 days
          searchUrl.searchParams.set('sort', 'date');

          console.log(`Google Search: ${query.substring(0, 80)}...`);

          const response = await fetch(searchUrl.toString());
          if (!response.ok) {
            if (response.status === 429) {
              console.warn('Google Search rate limited, pausing...');
              await delay(5000);
              continue;
            }
            console.error(`Google Search error: ${response.status}`);
            continue;
          }

          const data = await response.json();
          itemsScanned += data.items?.length || 0;

          for (const item of data.items || []) {
            // Skip excluded domains
            const itemUrl = (item.link || '').toLowerCase();
            if (EXCLUDED_DOMAINS.some(d => itemUrl.includes(d))) {
              console.log(`Skipping excluded domain: ${item.link?.substring(0, 60)}`);
              continue;
            }

            const content = `${item.title} ${item.snippet}`.toLowerCase();
            const relevance = scoreOutreachRelevance(content);

            // Google results already match queries, but raise threshold to reduce noise
            if (relevance.score >= 35) {
              const created = await createOutreachSignal(supabase, {
                clientId,
                source: `Google News: ${query.substring(0, 40)}`,
                title: item.title,
                description: item.snippet,
                url: item.link,
                publishedDate: null,
                relevanceScore: Math.min(relevance.score + 15, 100), // Boost for query match
                relevanceReasons: relevance.reasons,
                outreachType: relevance.outreachType,
              });
              if (created) signalsCreated++;
            }
          }

          sourcesProcessed.push(`Google: ${query.substring(0, 30)}`);
          await delay(250); // Rate limit Google API
        } catch (err) {
          console.error(`Google search error for query:`, err);
        }
      }
    } else {
      console.warn('Google Search API not configured — skipping Phase 2');
    }

    // ═══════════════════════════════════════════════════
    // Phase 3: Direct First Nations band site scanning
    // ═══════════════════════════════════════════════════
    const bandSites = [
      { name: 'Blueberry River First Nations', url: 'https://www.brfn.ca' },
      { name: 'Doig River First Nation', url: 'https://www.doigriverfn.com' },
      { name: 'Prophet River First Nation', url: 'https://prophetriverfirstnation.ca' },
      { name: 'West Moberly First Nations', url: 'https://www.westmo.org' },
      { name: 'Halfway River First Nation', url: 'https://www.halfwayriverfirstnation.com' },
      { name: 'Saulteau First Nations', url: 'https://www.saulteau.com' },
    ];

    console.log('Phase 3: Scanning First Nations band websites...');
    for (const band of bandSites) {
      try {
        const response = await fetch(band.url, {
          headers: { 'User-Agent': 'FORTRESS-Outreach-Monitor/1.0' },
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
          console.warn(`Band site ${band.name} returned ${response.status}`);
          continue;
        }

        const html = await response.text();
        // Extract text content, looking for news/events/announcements sections
        const textContent = extractTextFromHTML(html);
        itemsScanned++;

        // Only extract genuine event/announcement content — skip nav menus & page headings
        // Require a date or time indicator near the match to confirm it's a real announcement
        const eventPatterns = [
          /(?:(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+[\s\S]{0,100}?(?:event|meeting|gathering|ceremony|workshop|open house|consultation|announcement)[\s:]+([^.!?\n]{30,300}))/gi,
          /(?:(?:event|meeting|gathering|ceremony|workshop|open house|consultation|announcement)[\s:]+[\s\S]{0,50}?(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[\s\S]{0,200})/gi,
          /(?:news|press release|update|bulletin)[\s:]+([^.!?\n]{30,300})/gi,
        ];

        let bandSignalsCreated = 0;
        const MAX_BAND_SIGNALS = 3; // Cap per band to prevent scraping floods

        for (const pattern of eventPatterns) {
          if (bandSignalsCreated >= MAX_BAND_SIGNALS) break;
          let match;
          while ((match = pattern.exec(textContent)) !== null && bandSignalsCreated < MAX_BAND_SIGNALS) {
            const snippet = match[0].trim();
            
            // Skip very short or navigation-like text
            if (snippet.length < 40) continue;
            if (/^(public works|community development|band economic|agricultural planning|cultural tourism|urban)/i.test(snippet)) continue;
            
            const relevance = scoreOutreachRelevance(snippet.toLowerCase());

            if (relevance.score >= 35) {
              const created = await createOutreachSignal(supabase, {
                clientId,
                source: band.name,
                title: `${band.name}: ${snippet.substring(0, 80)}`,
                description: snippet,
                url: band.url,
                publishedDate: null,
                relevanceScore: relevance.score,
                relevanceReasons: [...relevance.reasons, `Source: ${band.name}`],
                outreachType: relevance.outreachType || 'first_nations',
              });
              if (created) {
                signalsCreated++;
                bandSignalsCreated++;
              }
            }
          }
        }

        sourcesProcessed.push(band.name);
        await delay(500);
      } catch (err) {
        console.warn(`Error scanning ${band.name}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`Community outreach monitoring complete. Created ${signalsCreated} signals from ${sourcesProcessed.length} sources.`);

    // Update monitoring history
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: itemsScanned,
          signals_created: signalsCreated,
          scan_metadata: {
            region: 'NE British Columbia',
            focus: 'community_outreach',
            sources_processed: sourcesProcessed,
            phases_completed: ['rss', googleApiKey ? 'google' : 'google_skipped', 'band_sites'],
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      items_scanned: itemsScanned,
      sources_processed: sourcesProcessed.length,
      phases: {
        rss: RSS_SOURCES.length,
        google_queries: googleApiKey ? OUTREACH_SEARCH_QUERIES.length : 0,
        band_sites: bandSites.length,
      }
    });

  } catch (error) {
    console.error('Community outreach monitoring error:', error);

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

// ═══════════════════════════════════════════════════════════
//                    SCORING & RELEVANCE
// ═══════════════════════════════════════════════════════════

interface RelevanceResult {
  score: number;
  reasons: string[];
  outreachType: string;
}

function scoreOutreachRelevance(content: string): RelevanceResult {
  let score = 0;
  const reasons: string[] = [];
  let outreachType = 'general';

  // Exclude if it's clearly a crime/emergency story
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(content)) {
      return { score: 0, reasons: ['Excluded: crime/emergency content'], outreachType: 'excluded' };
    }
  }

  // First Nations / Indigenous keywords (high value)
  const fnKeywords = ['first nations', 'indigenous', 'reconciliation', 'treaty',
    'nation-to-nation', 'duty to consult', 'aboriginal', 'métis',
    'blueberry river', 'doig river', 'halfway river', 'prophet river',
    'west moberly', 'saulteau', 'mcleod lake', 'tsay keh dene', 'kwadacha'];
  
  let fnMatches = 0;
  for (const kw of fnKeywords) {
    if (content.includes(kw)) {
      fnMatches++;
    }
  }
  if (fnMatches > 0) {
    score += 25 + Math.min(fnMatches * 5, 15);
    reasons.push(`First Nations keywords: ${fnMatches} matches`);
    outreachType = 'first_nations';
  }

  // Community engagement keywords
  const engagementKeywords = ['community engagement', 'public consultation', 'open house',
    'town hall', 'community meeting', 'stakeholder', 'public hearing',
    'community benefit', 'impact benefit agreement', 'social responsibility'];
  
  let engagementMatches = 0;
  for (const kw of engagementKeywords) {
    if (content.includes(kw)) {
      engagementMatches++;
    }
  }
  if (engagementMatches > 0) {
    score += 20 + Math.min(engagementMatches * 5, 15);
    reasons.push(`Engagement keywords: ${engagementMatches} matches`);
    if (outreachType === 'general') outreachType = 'community_engagement';
  }

  // Event/gathering keywords
  const eventKeywords = ['gathering', 'ceremony', 'cultural event', 'powwow',
    'workshop', 'conference', 'forum', 'summit', 'roundtable',
    'training program', 'employment opportunity', 'scholarship'];
  
  let eventMatches = 0;
  for (const kw of eventKeywords) {
    if (content.includes(kw)) {
      eventMatches++;
    }
  }
  if (eventMatches > 0) {
    score += 15 + Math.min(eventMatches * 5, 10);
    reasons.push(`Event keywords: ${eventMatches} matches`);
    if (outreachType === 'general') outreachType = 'event';
  }

  // Location relevance (NE BC)
  const locationKeywords = ['fort st. john', 'fort st john', 'dawson creek',
    'hudson\'s hope', 'chetwynd', 'tumbler ridge', 'taylor bc',
    'peace river', 'northeast bc', 'charlie lake', 'pink mountain'];
  
  let locationMatches = 0;
  for (const kw of locationKeywords) {
    if (content.includes(kw)) {
      locationMatches++;
    }
  }
  if (locationMatches > 0) {
    score += 15;
    reasons.push(`NE BC location: ${locationMatches} matches`);
  }

  // Government/regulatory context
  if (/\b(government|ministry|provincial|federal|regional district|municipal)\b/i.test(content)) {
    score += 5;
    reasons.push('Government context');
    if (outreachType === 'general') outreachType = 'government';
  }

  return { score: Math.min(score, 100), reasons, outreachType };
}

// ═══════════════════════════════════════════════════════════
//                    SIGNAL CREATION
// ═══════════════════════════════════════════════════════════

async function createOutreachSignal(supabase: any, data: {
  clientId: string | null;
  source: string;
  title: string;
  description: string;
  url: string | null;
  publishedDate: string | null;
  relevanceScore: number;
  relevanceReasons: string[];
  outreachType: string;
}): Promise<boolean> {
  try {
    // Generate content hash for deduplication
    const contentToHash = `${data.url || ''}|${data.title}`;
    const encoder = new TextEncoder();
    const hashData = encoder.encode(contentToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Check for existing signal
    const { data: existing } = await supabase
      .from('signals')
      .select('id')
      .eq('content_hash', contentHash)
      .single();

    if (existing) {
      console.log(`Skipping duplicate outreach signal: ${data.title.substring(0, 50)}`);
      return false;
    }

    const normalizedText = `[Community Outreach] ${data.title}\n\n${data.description}`;

    const { error } = await supabase
      .from('signals')
      .insert({
        client_id: data.clientId,
        category: 'community_outreach',
        severity: 'low',
        status: 'new',
        title: data.title,
        normalized_text: normalizedText,
        content_hash: contentHash,
        event_date: data.publishedDate ? new Date(data.publishedDate).toISOString() : null,
        confidence: data.relevanceScore,
        raw_json: {
          source: data.source,
          outreach_type: data.outreachType,
          relevance_score: data.relevanceScore,
          relevance_reasons: data.relevanceReasons,
          url: data.url,
          published_date: data.publishedDate,
        },
        received_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error creating outreach signal:', error);
      return false;
    }

    console.log(`✓ Outreach signal [${data.outreachType}]: ${data.title.substring(0, 60)}`);
    return true;
  } catch (err) {
    console.error('Error in createOutreachSignal:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//                    UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

function parseRSS(xmlText: string) {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title'),
      description: extractTag(itemXml, 'description'),
      link: extractTag(itemXml, 'link'),
      pubDate: extractTag(itemXml, 'pubDate'),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function extractTextFromHTML(html: string): string {
  // Strip tags, scripts, styles
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 10000) // Limit to first 10K chars
    .trim();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}