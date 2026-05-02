import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
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

// Platforms to search via Google CSE.
// Twitter/X is best indexed. Facebook public pages and Instagram public profiles
// are partially indexed — CSE returns fewer results but still catches public posts
// from activist pages and accounts that have web presence.
// Meta Graph API (when FACEBOOK_ACCESS_TOKEN is set) supplements CSE with real API access.
// Facebook deliberately omitted from CSE: Google injects post COMMENTS
// into the snippet field, so a CPP post by Department of Finance Canada
// with a TC-Energy comment on it would surface as a TC-Energy signal
// pointing at the CPP post URL — content/URL mismatch. We get clean
// Facebook coverage via the Graph API path further down (when
// FACEBOOK_ACCESS_TOKEN is set), and dedicated client-page scans
// further still. Twitter/Instagram CSE remain because their snippets
// are post text, not threaded comments.
const PLATFORMS = [
  { name: 'twitter', sites: ['site:x.com', 'site:twitter.com'], label: 'Twitter/X' },
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

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'monitor-social-unified');

  try {
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!apiKey || !engineId) {
      console.log('Google Search API not configured, skipping unified social monitor');
      await completeHeartbeat(supabase, hb, { signals_created: 0, note: 'GOOGLE_SEARCH_API_KEY/ENGINE_ID not configured' });
      return successResponse({ success: true, message: 'Google Search API not configured', signals_created: 0 });
    }

    console.log('[SocialUnified] Starting unified social media monitoring...');

    // Fetch clients and entities in parallel
    const [clientsResult, entitiesResult] = await Promise.all([
      supabase.from('clients').select('id, name, organization, industry, monitoring_keywords'),
      supabase.from('entities')
        .select('id, name, type, aliases, risk_level, attributes, client_id')
        .eq('active_monitoring_enabled', true)
        .in('type', ['organization', 'person'])
    ]);

    const clients = clientsResult.data || [];
    const entities = entitiesResult.data || [];

    // Build map of client_id → monitoring_keywords for entity query enrichment
    const clientKeywordsMap = new Map<string, string[]>();
    for (const c of clients) {
      if (c.id && c.monitoring_keywords?.length) {
        clientKeywordsMap.set(c.id, c.monitoring_keywords);
      }
    }

    console.log(`[SocialUnified] ${clients.length} clients, ${entities.length} entities`);

    // ═══ META GRAPH API — Facebook & Instagram (runs first when configured) ═══
    // Set FACEBOOK_ACCESS_TOKEN as "{app_id}|{app_secret}" from developers.facebook.com
    // This provides real API access to public Facebook page posts and Instagram hashtags,
    // supplementing the CSE fallback below.
    const metaToken = Deno.env.get('FACEBOOK_ACCESS_TOKEN');
    if (metaToken) {
      console.log('[SocialUnified] Meta Graph API configured — running FB/IG API phase');

      // Collect search terms: client keywords + entity names
      const metaSearchTerms: Array<{ term: string; clientId: string | null; entityId: string | null }> = [];
      for (const client of clients.slice(0, 4)) {
        for (const kw of (client.monitoring_keywords || []).slice(0, 4)) {
          metaSearchTerms.push({ term: kw, clientId: client.id, entityId: null });
        }
        metaSearchTerms.push({ term: client.name, clientId: client.id, entityId: null });
      }
      for (const entity of entities.filter((e: any) => e.type === 'person').slice(0, 8)) {
        metaSearchTerms.push({ term: entity.name, clientId: entity.client_id || null, entityId: entity.id });
      }

      // Step 1: Find relevant Facebook pages for each term
      const discoveredPageIds = new Set<string>();
      for (const { term } of metaSearchTerms.slice(0, 10)) {
        try {
          const pageSearchUrl = `https://graph.facebook.com/v21.0/pages/search?q=${encodeURIComponent(term)}&fields=id,name,link&limit=5&access_token=${metaToken}`;
          const pageResp = await fetch(pageSearchUrl);
          if (!pageResp.ok) continue;
          const pageData = await pageResp.json();
          for (const page of pageData.data || []) {
            discoveredPageIds.add(page.id);
          }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.warn(`[SocialUnified] Meta page search error for "${term}":`, e);
        }
      }

      // Step 2: Fetch recent posts from discovered pages
      const since24h = Math.floor((Date.now() - 24 * 3600000) / 1000);
      for (const pageId of Array.from(discoveredPageIds).slice(0, 15)) {
        try {
          const postsUrl = `https://graph.facebook.com/v21.0/${pageId}/posts?fields=message,story,permalink_url,created_time&limit=10&since=${since24h}&access_token=${metaToken}`;
          const postsResp = await fetch(postsUrl);
          if (!postsResp.ok) continue;
          const postsData = await postsResp.json();

          for (const post of postsData.data || []) {
            const text = (post.message || post.story || '').trim();
            if (text.length < 40) continue;

            // Find best matching client/entity for this post
            let matchedClientId: string | null = null;
            let matchedEntityId: string | null = null;
            const lowerText = text.toLowerCase();
            for (const { term, clientId, entityId } of metaSearchTerms) {
              if (lowerText.includes(term.toLowerCase())) {
                matchedClientId = clientId;
                matchedEntityId = entityId;
                break;
              }
            }

            await supabase.functions.invoke('ingest-signal', {
              body: {
                text,
                source_url: post.permalink_url || `https://facebook.com/${pageId}`,
                client_id: matchedClientId,
                raw_json: {
                  source: 'facebook_graph_api',
                  page_id: pageId,
                  created_time: post.created_time,
                  entity_id: matchedEntityId,
                },
              },
            });
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.warn(`[SocialUnified] Meta posts fetch error for page ${pageId}:`, e);
        }
      }

      // Step 3: Instagram hashtag monitoring via Graph API
      // Requires INSTAGRAM_BUSINESS_ACCOUNT_ID env var alongside FACEBOOK_ACCESS_TOKEN
      const igAccountId = Deno.env.get('INSTAGRAM_BUSINESS_ACCOUNT_ID');
      if (igAccountId) {
        const igHashtags: string[] = [];
        for (const client of clients.slice(0, 3)) {
          for (const kw of (client.monitoring_keywords || []).slice(0, 3)) {
            igHashtags.push(kw.replace(/\s+/g, '').toLowerCase());
          }
        }
        for (const hashtag of [...new Set(igHashtags)].slice(0, 8)) {
          try {
            const hashtagSearchUrl = `https://graph.facebook.com/v21.0/ig-hashtag-search?q=${encodeURIComponent(hashtag)}&user_id=${igAccountId}&access_token=${metaToken}`;
            const hashtagResp = await fetch(hashtagSearchUrl);
            if (!hashtagResp.ok) continue;
            const hashtagData = await hashtagResp.json();
            const hashtagId = hashtagData.data?.[0]?.id;
            if (!hashtagId) continue;

            const topMediaUrl = `https://graph.facebook.com/v21.0/${hashtagId}/recent_media?fields=caption,permalink,timestamp&limit=10&user_id=${igAccountId}&access_token=${metaToken}`;
            const mediaResp = await fetch(topMediaUrl);
            if (!mediaResp.ok) continue;
            const mediaData = await mediaResp.json();

            for (const media of mediaData.data || []) {
              const caption = (media.caption || '').trim();
              if (caption.length < 40) continue;
              await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `#${hashtag}\n\n${caption}`,
                  source_url: media.permalink,
                  raw_json: {
                    source: 'instagram_graph_api',
                    hashtag,
                    timestamp: media.timestamp,
                  },
                },
              });
            }
            await new Promise(r => setTimeout(r, 500));
          } catch (e) {
            console.warn(`[SocialUnified] Instagram hashtag error for #${hashtag}:`, e);
          }
        }
      }

      console.log('[SocialUnified] Meta Graph API phase complete');
    } else {
      console.log('[SocialUnified] FACEBOOK_ACCESS_TOKEN not set — using CSE only for FB/IG');
    }

    // ═══ SEARCH BUDGET ═══
    const MAX_SEARCHES = 25;
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
          query: `${siteFilter} "${client.name}" (protest OR blockade OR breach OR sabotage OR activist)`,
          platform: platform.name,
          sourceName: client.name,
          sourceType: 'client',
          clientId: client.id,
          entityId: null,
        });
      }
    }

    // Entity queries — prioritize those with platform handles
    for (const entity of entities.slice(0, 15)) {
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

      // Generic fallback if no handles — use client-specific or entity-level context terms
      if (!twitterHandle && !fbHandle && !igHandle) {
        // Prefer entity-level monitoring_context, then client keywords, then generic fallback
        let contextTerms = attrs.monitoring_context as string | undefined;
        if (!contextTerms && entity.client_id) {
          const clientKws = clientKeywordsMap.get(entity.client_id);
          if (clientKws?.length) {
            // Use up to 3 most specific client keywords as OR terms
            contextTerms = clientKws.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          }
        }
        if (!contextTerms) {
          contextTerms = 'pipeline OR LNG OR protest';
        }
        searchQueue.push({
          query: `site:x.com OR site:facebook.com OR site:instagram.com "${entity.name}" (${contextTerms})`,
          platform: 'multi',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: entity.client_id || null,
          entityId: entity.id,
        });
      }

      // Threat/targeting query for person entities — always added regardless of handles
      if (entity.type === 'person') {
        searchQueue.push({
          query: `"${entity.name}" (threat OR harass OR dox OR doxxed OR "personal information" OR "home address" OR protest OR "at risk")`,
          platform: 'multi',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: entity.client_id || null,
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

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      searches: totalSearches,
      ai_rejected: aiRejected,
      budget_remaining: searchBudgetRemaining,
    });

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
    await failHeartbeat(supabase, hb, error);
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

      // The Facebook-specific comment-pollution gate that previously
      // lived here was killing legitimate Twitter/Instagram CSE results
      // — those platforms put the post text in snippet (not title), so
      // requiring the search term to appear in title/URL rejected almost
      // every match. Removed entirely now that facebook is no longer in
      // PLATFORMS (the original reason for the gate). If facebook ever
      // comes back via CSE, scope this guard to URL host containing
      // 'facebook.com' so it doesn't catch Twitter/Instagram.

      // ═══ HARD TEMPORAL FILTER ═══
      // For campaign/client searches: reject URLs or snippets with obvious old dates (pre-2025).
      // For entity-specific scans: skip temporal filtering — profile pages, bios, and personal
      // websites contain permanent intel (contact info, affiliations, linked domains) that
      // doesn't expire. These are flagged as historical in metadata instead.
      const isEntityScan = search.sourceType === 'entity';
      const hasWikipedia = url.includes('wikipedia.org');

      if (hasWikipedia) {
        console.log(`[SocialUnified] ✗ Wikipedia filtered: "${title.substring(0, 50)}"`);
        rejected++;
        continue;
      }

      if (!isEntityScan) {
        const oldYearPattern = /\b(201[0-9]|202[0-3]|2024)\b/;
        const urlHasOldYear = oldYearPattern.test(url);
        const snippetDateContext = snippet.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*(201[0-9]|202[0-4])\b/i);

        if (urlHasOldYear && !url.includes('2025') && !url.includes('2026')) {
          console.log(`[SocialUnified] ✗ Old content filtered (campaign scan): "${title.substring(0, 50)}"`);
          rejected++;
          continue;
        }
        if (snippetDateContext) {
          console.log(`[SocialUnified] ✗ Old snippet date (campaign scan): "${snippetDateContext[0]}" in "${title.substring(0, 50)}"`);
          rejected++;
          continue;
        }
      }

      // ═══ HARD GEOGRAPHIC FILTER ═══
      // Reject non-Canadian XR chapters explicitly
      const nonCanadianXR = /(extinction rebellion)\s+(austria|germany|uk|cape town|australia|netherlands|sweden|norway|france|italy|spain|japan)/i;
      if (nonCanadianXR.test(content)) {
        console.log(`[SocialUnified] ✗ Non-Canadian XR: "${title.substring(0, 50)}"`);
        rejected++;
        continue;
      }

      // Skip generic profile pages (Facebook-specific) for campaign scans.
      // For entity scans: allow profile pages — they contain bio info, linked websites, and
      // contact details that are valuable permanent intelligence about the entity.
      if (url.includes('facebook.com') && !isSpecificFacebookUrl(url) && !isEntityScan) {
        console.log(`[SocialUnified] Skipping generic FB page (campaign scan): ${url}`);
        continue;
      }

      // ═══ AI RELEVANCE GATE ═══
      const aiVerdict = await aiRelevanceGate(title, snippet, url, search.sourceName, search.platform, isEntityScan);
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

      // Detect if this is historical content (for entity scans that bypassed temporal filter)
      const oldYearMatch = /\b(201[0-9]|202[0-3]|2024)\b/.exec(url + ' ' + snippet);
      const isHistorical = isEntityScan && !!oldYearMatch;

      // Extract external links from content (URLs to non-social-media sites)
      const externalLinks = extractExternalLinks(content + ' ' + snippet);

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

      // Ingest document — upsert so concurrent monitoring runs don't race to
      // insert the same URL. If source_url already exists, do nothing and doc
      // will be null, skipping the process-intelligence-document call below.
      const { data: doc, error: docError } = await supabase
        .from('ingested_documents')
        .upsert({
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
            hashtag_count: hashtags.length,
            is_historical: isHistorical,
            external_links: externalLinks,
          }
        }, { onConflict: 'source_url', ignoreDuplicates: true })
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

        // Follow external links found in entity-scan content.
        // Ingest each non-social external URL as its own document so the intelligence
        // pipeline processes it (e.g. amberbracken.com found in a Facebook profile).
        if (isEntityScan && search.entityId && externalLinks.length > 0) {
          console.log(`[SocialUnified] Found ${externalLinks.length} external link(s) in ${platform} content for ${search.sourceName}: ${externalLinks.join(', ')}`);
          for (const extUrl of externalLinks.slice(0, 3)) {
            try {
              // Check if already ingested
              const { data: existingDoc } = await supabase
                .from('ingested_documents')
                .select('id')
                .eq('source_url', extUrl)
                .limit(1);

              if (existingDoc && existingDoc.length > 0) {
                console.log(`[SocialUnified] External link already ingested: ${extUrl}`);
                continue;
              }

              const { data: linkedDoc, error: linkedErr } = await supabase
                .from('ingested_documents')
                .insert({
                  title: `Website linked from ${platform} profile: ${search.sourceName}`,
                  raw_text: `External website linked from ${platform} profile of ${search.sourceName}. URL: ${extUrl}`,
                  source_url: extUrl,
                  author_name: search.sourceName,
                  metadata: {
                    source: 'social_profile_link',
                    source_type: 'web',
                    entity_id: search.entityId,
                    source_name: search.sourceName,
                    linked_from: url,
                    linked_from_platform: platform,
                    is_historical: true,
                  }
                })
                .select()
                .single();

              if (!linkedErr && linkedDoc) {
                await supabase.from('document_entity_mentions').insert({
                  document_id: linkedDoc.id,
                  entity_id: search.entityId,
                  confidence: 0.9,
                  mention_text: search.sourceName,
                });
                await supabase.functions.invoke('process-intelligence-document', {
                  body: { documentId: linkedDoc.id }
                });
                console.log(`[SocialUnified] ✓ Queued external link for processing: ${extUrl}`);
              }
            } catch (linkErr) {
              console.warn(`[SocialUnified] Link follow failed for ${extUrl}:`, linkErr);
            }
          }
        }

        signals++;
        console.log(`[SocialUnified] ✓ Ingested ${platform} ${postType}: "${title.substring(0, 60)}"${isHistorical ? ' [historical]' : ''}`);
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
  platform: string,
  isEntityScan: boolean = false
): Promise<AiVerdict> {
  const fallback: AiVerdict = { relevant: false, reason: 'AI gate unavailable — defaulting to reject', confidence: 0, category: '', location: '' };

  const systemPrompt = isEntityScan
    ? `You are an intelligence analyst evaluating social media and web content about a specific monitored person or organization.

MISSION: Determine if this content contains ANY useful intelligence about the subject "${sourceName}". This is a PROFILE SCAN, not a news/event filter.

A result is relevant if it:
- Is a social media profile, post, bio, or page belonging to or about ${sourceName}
- Contains contact information, linked websites, affiliations, or associations
- References locations, activities, employment, relationships, or statements by ${sourceName}
- Is ANY age — historical posts and old profile content are valuable for building an intelligence picture
- Mentions the subject's personal website, organization, or other online presence

A result is NOT relevant if it:
- Is clearly about a completely different person or organization with the same name
- Is spam, advertisement, or auto-generated content with no actual information
- Is a totally unrelated topic that incidentally matches a keyword

Return JSON: { "relevant": boolean, "reason": string (1 sentence), "confidence": number (0-1), "category": string, "location": string }`
    : `You are an intelligence analyst filtering social media search results.
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

Return JSON: { "relevant": boolean, "reason": string (1 sentence), "confidence": number (0-1), "category": string, "location": string }`;

  try {
    const result = await callAiGatewayJson<AiVerdict>({
      model: 'openai/gpt-4o-mini',
      functionName: 'monitor-social-unified',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
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

/**
 * Extract external URLs from text content that point to non-social-media sites.
 * Used to follow personal websites, org pages, and other linked intel sources
 * found in social media profiles and posts.
 */
function extractExternalLinks(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const socialDomains = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'linkedin.com', 'youtube.com', 'youtu.be', 'google.com', 'apple.com',
    'bit.ly', 'linktr.ee', 't.co',
  ];

  const found = new Set<string>();
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[,.)]+$/, ''); // strip trailing punctuation
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (!socialDomains.some(d => host.endsWith(d))) {
        found.add(url);
      }
    } catch { /* invalid URL */ }
  }
  return Array.from(found);
}
