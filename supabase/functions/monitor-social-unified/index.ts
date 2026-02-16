import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
import {
  extractMentions,
  extractHashtags,
  parseEngagement,
  isHighPriorityContent,
  detectPostType,
  extractEventDetails,
  extractAuthorFromUrl
} from '../_shared/social-media-parser.ts';

/**
 * Unified Social Media Monitor
 * 
 * Consolidates monitor-twitter, monitor-facebook, and monitor-instagram
 * into a single function with:
 *   1. Shared search budget (MAX_SEARCHES)
 *   2. AI relevance gate (Gemini) before ingestion
 *   3. Cross-platform deduplication
 *   4. Rate-limit bail-out
 *   5. 50s execution ceiling
 */

// Platforms to search via Google CSE
const PLATFORMS = [
  { name: 'twitter', sites: ['site:x.com', 'site:twitter.com'], label: 'Twitter/X' },
  { name: 'facebook', sites: ['site:facebook.com'], label: 'Facebook' },
  { name: 'instagram', sites: ['site:instagram.com'], label: 'Instagram' },
] as const;

// HIGH-SPECIFICITY keywords — generic terms cause too many false positives
const ACTIVISM_KEYWORDS = [
  'Coastal GasLink', 'CGL pipeline', 'PRGT', "Wet'suwet'en", "Gidimt'en",
  "Unist'ot'en", 'Petronas Canada', 'LNG Canada', 'Cedar LNG',
  'Ksi Lisims', 'Prince Rupert Gas', 'TC Energy pipeline',
  'stand.earth', 'standearth', 'Dogwood BC', 'Dogwood Initiative',
  'BC Counter Info', 'Frack Free BC', 'pipeline blockade',
  'pipeline sabotage', 'pipeline protest', 'LNG protest', 'LNG blockade',
  'indigenous pipeline', 'first nation pipeline',
  'Shut Down Canada', 'land defender pipeline'
];

// Domains that never contain actionable intelligence
const BLOCKED_DOMAINS = [
  'tiktok.com', 'eventbrite.com', 'pinterest.com', 'etsy.com',
  'amazon.com', 'ebay.com', 'spotify.com', 'soundcloud.com',
  'yelp.com', 'tripadvisor.com', 'imdb.com'
];

// Custom error to signal rate limit bail-out
class RateLimitError extends Error {
  constructor() { super('Google API rate limited'); this.name = 'RateLimitError'; }
}

// Execution ceiling to prevent 504 Gateway Timeouts
const EXECUTION_CEILING_MS = 50_000;
const startTime = Date.now();
function isTimeUp(): boolean { return Date.now() - startTime > EXECUTION_CEILING_MS; }

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!apiKey || !engineId) {
      console.log('Google Search API not configured, skipping unified social monitor');
      return successResponse({ success: true, message: 'Google Search API not configured', signals_created: 0 });
    }

    console.log('[SocialUnified] Starting unified social media monitoring...');

    // Fetch clients and entities in parallel
    const [clientsResult, entitiesResult] = await Promise.all([
      supabase.from('clients').select('id, name, organization, industry, monitoring_keywords'),
      supabase.from('entities')
        .select('id, name, type, aliases, risk_level, attributes')
        .eq('active_monitoring_enabled', true)
        .in('type', ['organization', 'person'])
    ]);

    const clients = clientsResult.data || [];
    const entities = entitiesResult.data || [];

    console.log(`[SocialUnified] ${clients.length} clients, ${entities.length} entities`);

    // ═══ SEARCH BUDGET ═══
    const MAX_SEARCHES = 15;
    let searchBudgetRemaining = MAX_SEARCHES;
    let signalsCreated = 0;
    let aiRejected = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // Build search queue: interleave platforms for diversity
    const searchQueue: Array<{
      query: string;
      platform: string;
      sourceName: string;
      sourceType: 'client' | 'entity';
      clientId: string | null;
      entityId: string | null;
    }> = [];

    // Client queries — one per platform per client (3 queries per client max)
    for (const client of clients.slice(0, 4)) {
      for (const platform of PLATFORMS) {
        const siteFilter = platform.sites[0];
        searchQueue.push({
          query: `${siteFilter} "${client.name}" (protest OR blockade OR breach OR hack OR activist)`,
          platform: platform.name,
          sourceName: client.name,
          sourceType: 'client',
          clientId: client.id,
          entityId: null,
        });
      }
    }

    // Entity queries — prioritize those with platform handles
    for (const entity of entities.slice(0, 6)) {
      const attrs = entity.attributes || {};
      
      // Twitter/X
      const twitterHandle = attrs.twitter_handle || attrs.x_handle || 
        entity.aliases?.find((a: string) => a.startsWith('@'));
      if (twitterHandle) {
        const clean = twitterHandle.replace('@', '');
        searchQueue.push({
          query: `site:x.com/${clean}`,
          platform: 'twitter',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: null,
          entityId: entity.id,
        });
      }

      // Facebook
      const fbHandle = attrs.facebook_page || attrs.facebook_handle;
      if (fbHandle) {
        searchQueue.push({
          query: `site:facebook.com/${fbHandle}`,
          platform: 'facebook',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: null,
          entityId: entity.id,
        });
      }

      // Instagram
      const igHandle = attrs.instagram_handle || entity.aliases?.find((a: string) => a.startsWith('@'));
      if (igHandle) {
        const clean = igHandle.replace('@', '');
        searchQueue.push({
          query: `site:instagram.com/${clean}`,
          platform: 'instagram',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: null,
          entityId: entity.id,
        });
      }

      // Generic fallback if no handles
      if (!twitterHandle && !fbHandle && !igHandle) {
        searchQueue.push({
          query: `site:x.com OR site:facebook.com OR site:instagram.com "${entity.name}" (pipeline OR LNG OR protest)`,
          platform: 'multi',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: null,
          entityId: entity.id,
        });
      }
    }

    // ═══ BROAD ACTIVISM CAMPAIGN QUERIES ═══
    // These catch anti-industry campaigns that don't mention specific clients
    const CAMPAIGN_QUERIES = [
      // Anti-pipeline / oil & gas campaigns (generic)
      '"stop pipelines" OR "ban pipelines" OR "no new pipelines" (Canada OR BC OR Alberta)',
      '"fossil fuel" campaign (pipeline OR LNG) (Canada OR British Columbia OR Alberta)',
      // Known activist orgs — broad campaign monitoring
      'standearth OR "stand.earth" (pipeline OR LNG OR "oil and gas" OR "fossil fuel")',
      '"Dogwood BC" OR "Dogwood Initiative" (pipeline OR LNG OR campaign)',
      '"BC Counter Info" OR "Frack Free BC" (pipeline OR action OR blockade)',
      // Indigenous-led pipeline resistance (broad)
      '"land defender" OR "land back" (pipeline OR LNG OR "oil and gas") Canada',
    ];

    for (const campaignQuery of CAMPAIGN_QUERIES) {
      if (searchBudgetRemaining <= 0) break;
      for (const platform of PLATFORMS) {
        if (searchBudgetRemaining <= 0) break;
        searchQueue.push({
          query: `${platform.sites[0]} ${campaignQuery}`,
          platform: platform.name,
          sourceName: 'Industry Campaign Monitor',
          sourceType: 'client' as const,
          clientId: null,
          entityId: null,
        });
      }
    }

    // Process search queue
    for (const search of searchQueue) {
      if (searchBudgetRemaining <= 0 || isTimeUp()) {
        console.log(`[SocialUnified] Stopping: budget=${searchBudgetRemaining}, timeUp=${isTimeUp()}`);
        break;
      }

      try {
        // Rate limiting between searches
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

        totalSearches++;
        searchBudgetRemaining--;

        const result = await executeSearch(supabase, apiKey, engineId, search, processedUrls);
        signalsCreated += result.signals;
        aiRejected += result.rejected;

      } catch (error) {
        if (error instanceof RateLimitError) {
          console.log('[SocialUnified] Rate limited — stopping all searches');
          break;
        }
        console.error(`[SocialUnified] Search error for ${search.sourceName}:`, error);
      }
    }

    console.log(`[SocialUnified] Complete. Searches: ${totalSearches}, Signals: ${signalsCreated}, AI-rejected: ${aiRejected}`);

    return successResponse({
      success: true,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      ai_rejected: aiRejected,
      budget_remaining: searchBudgetRemaining,
      source: 'social-unified'
    });

  } catch (error) {
    console.error('[SocialUnified] Fatal error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Core search + ingest pipeline
// ═══════════════════════════════════════════════════════════════

async function executeSearch(
  supabase: any,
  apiKey: string,
  engineId: string,
  search: {
    query: string;
    platform: string;
    sourceName: string;
    sourceType: 'client' | 'entity';
    clientId: string | null;
    entityId: string | null;
  },
  processedUrls: Set<string>
): Promise<{ signals: number; rejected: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let signals = 0;
  let rejected = 0;

  try {
    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(search.query)}&num=5`;

    const response = await fetch(apiUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      if (response.status === 429) throw new RateLimitError();
      console.log(`[SocialUnified] Search failed: ${response.status}`);
      return { signals: 0, rejected: 0 };
    }

    const data = await response.json();
    const items = data.items || [];

    for (const item of items.slice(0, 5)) {
      if (isTimeUp()) break;

      const url = item.link || '';
      const title = item.title || '';
      const snippet = item.snippet || '';
      const domain = item.displayLink || '';
      const content = `${title} ${snippet}`.trim();

      // Skip if already processed or too short
      if (!url || processedUrls.has(url) || content.length < 30) continue;
      processedUrls.add(url);

      // Domain blocklist
      if (BLOCKED_DOMAINS.some(d => domain.includes(d))) {
        console.log(`[SocialUnified] Blocked domain: ${domain}`);
        continue;
      }

      // ═══ HARD TEMPORAL FILTER ═══
      // Reject URLs or snippets with obvious old dates (pre-2025)
      const oldYearPattern = /\b(201[0-9]|202[0-3]|2024)\b/;
      const urlHasOldYear = oldYearPattern.test(url);
      const snippetDateContext = snippet.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*(201[0-9]|202[0-4])\b/i);
      const hasWikipedia = url.includes('wikipedia.org');
      
      if (hasWikipedia || (urlHasOldYear && !url.includes('2025') && !url.includes('2026'))) {
        console.log(`[SocialUnified] ✗ Old content filtered: "${title.substring(0, 50)}" (URL date or Wikipedia)`);
        rejected++;
        continue;
      }
      if (snippetDateContext) {
        console.log(`[SocialUnified] ✗ Old snippet date: "${snippetDateContext[0]}" in "${title.substring(0, 50)}"`);
        rejected++;
        continue;
      }

      // ═══ HARD GEOGRAPHIC FILTER ═══
      // Reject non-Canadian XR chapters explicitly
      const nonCanadianXR = /(extinction rebellion)\s+(austria|germany|uk|cape town|australia|netherlands|sweden|norway|france|italy|spain|japan)/i;
      if (nonCanadianXR.test(content)) {
        console.log(`[SocialUnified] ✗ Non-Canadian XR: "${title.substring(0, 50)}"`);
        rejected++;
        continue;
      }

      // Skip generic profile pages (Facebook-specific)
      if (url.includes('facebook.com') && !isSpecificFacebookUrl(url)) {
        console.log(`[SocialUnified] Skipping generic FB page: ${url}`);
        continue;
      }

      // ═══ AI RELEVANCE GATE ═══
      const aiVerdict = await aiRelevanceGate(title, snippet, url, search.sourceName, search.platform);
      if (!aiVerdict.relevant) {
        console.log(`[SocialUnified] ✗ AI rejected: "${title.substring(0, 60)}" — ${aiVerdict.reason}`);
        rejected++;
        continue;
      }

      // Check for duplicates in DB
      const { data: existing } = await supabase
        .from('ingested_documents')
        .select('id')
        .eq('source_url', url)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log('[SocialUnified] Duplicate URL, skipping');
        continue;
      }

      // Extract social metadata
      const mentions = extractMentions(content);
      const hashtags = extractHashtags(content);
      const postType = detectPostType(url, content);
      const eventDetails = extractEventDetails(content);
      const platform = detectPlatformFromUrl(url);

      // Determine category
      const lowerContent = content.toLowerCase();
      let category = 'social_media';
      if (lowerContent.includes('protest') || lowerContent.includes('blockade') || lowerContent.includes('demonstration')) {
        category = 'protest_activity';
      } else if (lowerContent.includes('facebook live') || lowerContent.includes('live video') || lowerContent.includes('streaming live')) {
        category = 'live_stream';
      } else if (ACTIVISM_KEYWORDS.some(k => lowerContent.includes(k.toLowerCase()))) {
        category = 'activism';
      }

      // Ingest document
      const { data: doc, error: docError } = await supabase
        .from('ingested_documents')
        .insert({
          title: `${platform} ${postType}: ${search.sourceName}`,
          raw_text: content,
          source_url: url,
          post_caption: content,
          author_name: search.sourceName,
          mentions,
          hashtags,
          media_type: postType,
          metadata: {
            source: platform.toLowerCase(),
            source_type: 'social_media',
            client_id: search.clientId,
            entity_id: search.entityId,
            source_name: search.sourceName,
            search_type: search.sourceType,
            search_query: search.query,
            category,
            ai_verdict: aiVerdict,
            is_high_priority: isHighPriorityContent(content),
            event_details: eventDetails,
            detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerContent.includes(k.toLowerCase())),
            mentioned_accounts: mentions,
            hashtag_count: hashtags.length
          }
        })
        .select()
        .single();

      if (!docError && doc) {
        // Link to entity
        if (search.entityId) {
          await supabase.from('document_entity_mentions').insert({
            document_id: doc.id,
            entity_id: search.entityId,
            confidence: aiVerdict.confidence || 0.8,
            mention_text: search.sourceName
          });
        }

        // Trigger intelligence processing
        await supabase.functions.invoke('process-intelligence-document', {
          body: { documentId: doc.id }
        });

        signals++;
        console.log(`[SocialUnified] ✓ Ingested ${platform} ${postType}: "${title.substring(0, 60)}"`);
      }
    }

  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[SocialUnified] Search timeout');
    } else {
      console.error('[SocialUnified] Search processing error:', error);
    }
  }

  return { signals, rejected };
}

// ═══════════════════════════════════════════════════════════════
// AI Relevance Gate — Gemini validates each result before ingestion
// ═══════════════════════════════════════════════════════════════

interface AiVerdict {
  relevant: boolean;
  reason: string;
  confidence: number;
  category: string;
  location: string;
}

async function aiRelevanceGate(
  title: string,
  snippet: string,
  url: string,
  sourceName: string,
  platform: string
): Promise<AiVerdict> {
  const fallback: AiVerdict = { relevant: false, reason: 'AI gate unavailable — defaulting to reject', confidence: 0, category: '', location: '' };

  try {
    const result = await callAiGatewayJson<AiVerdict>({
      model: 'google/gemini-2.5-flash-lite',
      functionName: 'monitor-social-unified',
      messages: [
        {
          role: 'system',
          content: `You are an intelligence analyst filtering social media search results.
You must determine if this result is OPERATIONALLY RELEVANT to security monitoring for Canadian energy infrastructure clients (pipelines, LNG facilities, energy companies).

CRITICAL TEMPORAL RULE: Reject any content where the original post or event date is MORE THAN 90 DAYS OLD. Look for date indicators in the snippet, title, or URL (e.g., "2019", "2021", "6 years ago", "posted on December 2019"). Old social media posts resurfacing via search engines are NOT actionable intelligence.

CRITICAL GEOGRAPHIC RULE: Reject content about protests, activism, or events that physically occurred OUTSIDE of Canada, even if the organization name matches (e.g., "Extinction Rebellion Austria", "XR Cape Town", "XR Germany" are NOT relevant). Only Canadian-occurring events qualify.

A result is relevant if it:
- Describes RECENT (within 90 days) activism, protests, blockades, or sabotage targeting energy infrastructure
- Mentions a specific threat, breach, or security incident related to the monitored entity
- Is a specific social media POST (not a generic profile page, directory listing, or unrelated content)
- Physically relates to Canadian geography or Canadian energy companies
- Has a discernible date that is recent (within the last 90 days)

A result is NOT relevant if it:
- Is about unrelated topics that happen to match keywords (e.g., "pipeline" in software, unrelated protests)
- Is a generic page, profile, or directory listing
- Is international news with no Canadian connection
- Is entertainment, marketing, or spam content
- References events from years ago (2019, 2020, 2021, 2022, 2023, early 2024)
- Is about Extinction Rebellion chapters outside Canada (Austria, Germany, UK, Cape Town, etc.)
- Is a Wikipedia article, historical reference, or archived content
- Cannot be dated — if no date is discernible and content appears old, reject it

Return JSON: { "relevant": boolean, "reason": string (1 sentence), "confidence": number (0-1), "category": string, "location": string }`
        },
        {
          role: 'user',
          content: `Platform: ${platform}\nMonitored entity: "${sourceName}"\nTitle: ${title}\nSnippet: ${snippet}\nURL: ${url}`
        }
      ],
      extraBody: { response_format: { type: 'json_object' } },
      retries: 1,
    });

    if (result.error || !result.data) {
      console.warn(`[SocialUnified] AI gate failed: ${result.error}`);
      // On AI failure, fall back to keyword matching
      return keywordFallback(title, snippet, sourceName);
    }

    return result.data;

  } catch (error) {
    console.warn('[SocialUnified] AI gate exception:', error);
    return keywordFallback(title, snippet, sourceName);
  }
}

/** Fallback if AI gate is unavailable — strict keyword match only */
function keywordFallback(title: string, snippet: string, sourceName: string): AiVerdict {
  const combined = `${title} ${snippet}`.toLowerCase();
  const hasKeyword = ACTIVISM_KEYWORDS.some(k => combined.includes(k.toLowerCase()));
  const hasSourceName = combined.includes(sourceName.toLowerCase());
  const relevant = hasKeyword || (hasSourceName && isHighPriorityContent(`${title} ${snippet}`));
  return {
    relevant,
    reason: relevant ? 'Keyword fallback match' : 'No keyword match (AI unavailable)',
    confidence: relevant ? 0.6 : 0,
    category: 'social_media',
    location: ''
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function isSpecificFacebookUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const specificPatterns = [
    '/posts/', '/videos/', '/watch/', '/reel/', '/events/',
    '/live/', '/story/', '/photo', 'video_id=', 'story_fbid=', 'permalink'
  ];
  return specificPatterns.some(p => lower.includes(p));
}

function detectPlatformFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'Twitter/X';
  if (lower.includes('facebook.com')) return 'Facebook';
  if (lower.includes('instagram.com')) return 'Instagram';
  return 'Social Media';
}
