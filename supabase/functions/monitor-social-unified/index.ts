import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import {
  resolveArchetype,
  getClientThreatVocab,
  getClientAiSystemPrompt,
  isOwnedProfileFor,
  isFixtureClient,
} from "../_shared/archetypes.ts";
import { pickActiveClients } from "../_shared/pick-active-clients.ts";
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
      // PROD-N Tranche A: shape-compliance even on early exit. Zero
      // queries / clients because we exited before pickActiveClients
      // and the search loop. fixture_clients_iterated=[] communicates
      // "filter is wired but didn't run this cycle", distinct from
      // `undefined` which would imply the filter isn't wired at all.
      await completeHeartbeat(supabase, hb, {
        signals_created: 0,
        note: 'GOOGLE_SEARCH_API_KEY/ENGINE_ID not configured',
        queries_executed: 0,
        distinct_clients_iterated: 0,
        fixture_clients_iterated: [],
      });
      return successResponse({ success: true, message: 'Google Search API not configured', signals_created: 0 });
    }

    console.log('[SocialUnified] Starting unified social media monitoring...');

    // Fetch clients and entities in parallel.
    // PROD-H: SELECTs monitoring_config so the per-client archetype is
    // available downstream for query generation + AI relevance gate.
    //
    // PROD-N Tranche A (2026-05-22): centralized fixture-isolation via
    // _shared/pick-active-clients.ts. The previous inline isFixtureClient
    // filter at this site is now inside the helper. The change captures
    // `excluded_fixtures` so we can feed it into fixture_clients_iterated
    // on completeHeartbeat — watchdog Rule D (PROD-N Phase 1) will then
    // detect any regression that bypasses the helper.
    const [activeClientsResult, entitiesResult] = await Promise.all([
      pickActiveClients<{
        id: string;
        name: string;
        organization?: string | null;
        industry?: string | null;
        monitoring_keywords?: string[] | null;
        monitoring_config?: any;
      }>(supabase, {
        select: 'id, name, organization, industry, monitoring_keywords, monitoring_config',
      }),
      supabase.from('entities')
        .select('id, name, type, aliases, risk_level, attributes, client_id')
        .eq('active_monitoring_enabled', true)
        .in('type', ['organization', 'person'])
    ]);

    const clients = activeClientsResult.active;
    const excludedFixtures = activeClientsResult.excluded_fixtures;
    const entities = entitiesResult.data || [];

    // Build map of client_id → monitoring_keywords for entity query enrichment
    const clientKeywordsMap = new Map<string, string[]>();
    // PROD-H: parallel map of client_id → monitoring_config so entity-scope
    // searches inherit their parent client's archetype for AI prompt + filter.
    const clientConfigMap = new Map<string, any>();
    // Track whether any active client uses the energy_infrastructure archetype.
    // Used to gate the Petronas-era CAMPAIGN_QUERIES (pipeline/LNG anti-industry
    // sweeps) so they don't fire when no energy clients are active.
    let hasEnergyInfrastructureClient = false;
    for (const c of clients) {
      if (c.id && c.monitoring_keywords?.length) {
        clientKeywordsMap.set(c.id, c.monitoring_keywords);
      }
      if (c.id) {
        clientConfigMap.set(c.id, c.monitoring_config ?? null);
      }
      if (resolveArchetype(c.monitoring_config) === 'energy_infrastructure') {
        hasEnergyInfrastructureClient = true;
      }
    }

    console.log(`[SocialUnified] ${clients.length} clients, ${entities.length} entities, hasEnergyInfra=${hasEnergyInfrastructureClient}`);

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
          queriesExecuted++; // PROD-N: upstream attempt initiated (counted before fetch)
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
          queriesExecuted++; // PROD-N: upstream attempt initiated (counted before fetch)
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
      //
      // #256 Phase 2 (2026-05-23) — EXPLICIT-OWNERSHIP HASHTAG ATTRIBUTION
      // Pre-#256 code derived hashtags from each client's monitoring_keywords,
      // then deduped (`new Set(...)`) which discarded attribution — the
      // subsequent ingest call omitted client_id, falling into the cross-tenant
      // scoring loop in ingest-signal. Empirical risk: Tenant A's "#pipeline"
      // and Tenant B's "#pipeline" merged into one untracked hashtag string;
      // every signal landed in whichever tenant's keywords scored highest.
      //
      // Fix: track (hashtag → Set<owning client_id>). For each matching media
      // post, emit ONE signal per owning client with explicit client_id. When
      // a hashtag is shared across tenants, fan out (one signal per owner) so
      // each owning client sees its own copy. Per #256 hard rule: explicit
      // ownership OR skip — never "let AI match" or "pick a winner".
      const igAccountId = Deno.env.get('INSTAGRAM_BUSINESS_ACCOUNT_ID');
      if (igAccountId) {
        const hashtagOwners = new Map<string, Set<string>>();
        for (const client of clients.slice(0, 3)) {
          for (const kw of (client.monitoring_keywords || []).slice(0, 3)) {
            const hashtag = kw.replace(/\s+/g, '').toLowerCase();
            if (!hashtag) continue;
            let owners = hashtagOwners.get(hashtag);
            if (!owners) {
              owners = new Set();
              hashtagOwners.set(hashtag, owners);
            }
            owners.add(client.id);
          }
        }
        const hashtagEntries = [...hashtagOwners.entries()].slice(0, 8);
        for (const [hashtag, ownerSet] of hashtagEntries) {
          // Skip (don't query Graph API) if attribution somehow empty — never
          // emit unattributed signals.
          if (ownerSet.size === 0) {
            console.warn(`[SocialUnified][#256] skipping hashtag #${hashtag}: no owning client`);
            continue;
          }
          try {
            const hashtagSearchUrl = `https://graph.facebook.com/v21.0/ig-hashtag-search?q=${encodeURIComponent(hashtag)}&user_id=${igAccountId}&access_token=${metaToken}`;
            queriesExecuted++; // PROD-N: upstream attempt initiated (counted before fetch)
            const hashtagResp = await fetch(hashtagSearchUrl);
            if (!hashtagResp.ok) continue;
            const hashtagData = await hashtagResp.json();
            const hashtagId = hashtagData.data?.[0]?.id;
            if (!hashtagId) continue;

            const topMediaUrl = `https://graph.facebook.com/v21.0/${hashtagId}/recent_media?fields=caption,permalink,timestamp&limit=10&user_id=${igAccountId}&access_token=${metaToken}`;
            queriesExecuted++; // PROD-N: upstream attempt initiated (counted before fetch)
            const mediaResp = await fetch(topMediaUrl);
            if (!mediaResp.ok) continue;
            const mediaData = await mediaResp.json();

            for (const media of mediaData.data || []) {
              const caption = (media.caption || '').trim();
              if (caption.length < 40) continue;
              // Fan out: one signal per owning client (explicit attribution).
              for (const ownerClientId of ownerSet) {
                await supabase.functions.invoke('ingest-signal', {
                  body: {
                    text: `#${hashtag}\n\n${caption}`,
                    source_url: media.permalink,
                    client_id: ownerClientId,
                    raw_json: {
                      source: 'instagram_graph_api',
                      hashtag,
                      timestamp: media.timestamp,
                      // Visibility into fan-out: if the same hashtag is owned
                      // by multiple clients, each gets its own signal copy.
                      hashtag_owner_count: ownerSet.size,
                    },
                  },
                });
              }
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

    // PROD-N Tranche A (2026-05-22): "upstream attempt initiated" counter.
    //
    // Distinct semantic from `totalSearches`/`searches`:
    //   - `totalSearches` counts CSE search-queue iterations (incremented
    //     at line 478 BEFORE the budget check is finalized, includes
    //     attempts that never reach upstream).
    //   - `queriesExecuted` counts every fetch() to an external service
    //     where the request was actually initiated — incremented
    //     IMMEDIATELY BEFORE each fetch call (CSE + every Meta Graph
    //     endpoint). Includes HTTP errors, 429s, timeouts, network
    //     exceptions, AND successful responses; excludes calls that
    //     never get sent because the function exited or branched before
    //     the fetch.
    //
    // Why distinct: watchdog Rule C (PROD-N Phase 1) classifies "scope
    // generation failing" on queries_executed=0. If we incremented after
    // fetch() returns, network failures would undercount and produce
    // false Rule C classifications. The "initiated" semantic is
    // crash-resilient.
    let queriesExecuted = 0;

    const processedUrls = new Set<string>();

    // Per-stage rejection telemetry — see RejectionCounters/Sample
    // types above. Existing aiRejected stays for backward compat but is
    // the SUM of all rejection sites; rejectionCounters breaks it out.
    const rejectionCounters = newRejectionCounters();
    const rejectionSamples: RejectionSample[] = [];
    const addSamplesFromSearch = (incoming: RejectionSample[]) => {
      for (const s of incoming) {
        addSampleIfRoom(rejectionSamples, s.stage as keyof RejectionCounters, {
          reason: s.reason,
          query: s.query, platform: s.platform,
          source_name: s.source_name, source_type: s.source_type,
          url: s.url, title: s.title, snippet: s.snippet,
        });
      }
    };

    // Build search queue: interleave platforms for diversity.
    // PROD-H: each search now carries the client's monitoring_config so
    // downstream code (query generation, AI relevance gate, profile
    // filter) can resolve the archetype per-search instead of running
    // off hardcoded Petronas-era vocab.
    const searchQueue: Array<{
      query: string;
      platform: string;
      sourceName: string;
      sourceType: 'client' | 'entity';
      clientId: string | null;
      entityId: string | null;
      monitoringConfig: any;  // client.monitoring_config (JSONB) | null
    }> = [];

    // Client queries — one per platform per client (3 queries per client max).
    // PROD-H: threat-vocab tail is now driven by client.monitoring_config.archetype
    // via getClientThreatVocab() instead of the hardcoded
    // (protest OR blockade OR breach OR sabotage OR activist) Petronas terms.
    // Clients without an archetype configured fall back to energy_infrastructure
    // (preserves prior behavior for Petronas / BCCH / similar).
    for (const client of clients.slice(0, 4)) {
      const threatVocab = getClientThreatVocab(client.monitoring_config);
      for (const platform of PLATFORMS) {
        const siteFilter = platform.sites[0];
        searchQueue.push({
          query: `${siteFilter} "${client.name}" (${threatVocab})`,
          platform: platform.name,
          sourceName: client.name,
          sourceType: 'client',
          clientId: client.id,
          entityId: null,
          monitoringConfig: client.monitoring_config ?? null,
        });
      }
    }

    // Entity queries — prioritize those with platform handles.
    // PROD-H: each entity search inherits its parent client's
    // monitoring_config so the AI relevance gate uses the correct
    // archetype prompt. Entity-scan branch in aiRelevanceGate is
    // already subject-agnostic, but the profile filter + future
    // hooks need the archetype context too.
    for (const entity of entities.slice(0, 15)) {
      const attrs = entity.attributes || {};
      const entityClientConfig = entity.client_id ? (clientConfigMap.get(entity.client_id) ?? null) : null;

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
          monitoringConfig: entityClientConfig,
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
          monitoringConfig: entityClientConfig,
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
          monitoringConfig: entityClientConfig,
        });
      }

      // Generic fallback if no handles — use entity context > client keywords > archetype vocab.
      // PROD-H: the legacy hardcoded fallback was `pipeline OR LNG OR protest` (Petronas-era).
      // Now derives the fallback from the parent client's archetype threat_vocab.
      if (!twitterHandle && !fbHandle && !igHandle) {
        let contextTerms = attrs.monitoring_context as string | undefined;
        if (!contextTerms && entity.client_id) {
          const clientKws = clientKeywordsMap.get(entity.client_id);
          if (clientKws?.length) {
            contextTerms = clientKws.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          }
        }
        if (!contextTerms) {
          contextTerms = getClientThreatVocab(entityClientConfig);
        }
        searchQueue.push({
          query: `site:x.com OR site:facebook.com OR site:instagram.com "${entity.name}" (${contextTerms})`,
          platform: 'multi',
          sourceName: entity.name,
          sourceType: 'entity',
          clientId: entity.client_id || null,
          entityId: entity.id,
          monitoringConfig: entityClientConfig,
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
          monitoringConfig: entityClientConfig,
        });
      }
    }

    // ═══ BROAD ACTIVISM CAMPAIGN QUERIES (energy-infrastructure only) ═══
    // PROD-H: these are Petronas-era anti-pipeline / anti-LNG / activist-org
    // sweeps. They are scope-specific to the energy_infrastructure archetype
    // and must not fire when no energy clients are active in the rotation
    // (firing them for a CRT-only tenant would spend budget on
    // industry-protest content that has no relevance to sports / VIP / event).
    // Synthetic monitoringConfig pins the AI gate to the energy prompt.
    if (hasEnergyInfrastructureClient) {
      const CAMPAIGN_QUERIES = [
        '"stop pipelines" OR "ban pipelines" OR "no new pipelines" (Canada OR BC OR Alberta)',
        '"fossil fuel" campaign (pipeline OR LNG) (Canada OR British Columbia OR Alberta)',
        'standearth OR "stand.earth" (pipeline OR LNG OR "oil and gas" OR "fossil fuel")',
        '"Dogwood BC" OR "Dogwood Initiative" (pipeline OR LNG OR campaign)',
        '"BC Counter Info" OR "Frack Free BC" (pipeline OR action OR blockade)',
        '"land defender" OR "land back" (pipeline OR LNG OR "oil and gas") Canada',
      ];

      const ENERGY_CAMPAIGN_CONFIG = { archetype: 'energy_infrastructure' as const };

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
            monitoringConfig: ENERGY_CAMPAIGN_CONFIG,
          });
        }
      }
    } else {
      console.log('[SocialUnified] Skipping CAMPAIGN_QUERIES — no energy_infrastructure clients in active rotation');
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
        mergeCounters(rejectionCounters, result.counters);
        addSamplesFromSearch(result.samples);
        // PROD-N Tranche A: accumulate "upstream attempt initiated" count
        // from executeSearch's return. This is the success path; the
        // catch block below has a fallback +1 to preserve count when
        // executeSearch throws after its internal increment.
        queriesExecuted += result.queries_executed;

      } catch (error) {
        if (error instanceof RateLimitError) {
          // PROD-N Tranche A: rate-limit thrown AFTER the fetch returned
          // a 429 — the upstream attempt was initiated, so count it.
          // executeSearch's return value was lost in the throw path.
          queriesExecuted++;
          console.log('[SocialUnified] Rate limited — stopping all searches');
          break;
        }
        // PROD-N Tranche A: other error path (timeout, network). By
        // contract executeSearch sets queriesExecutedThisCall=1 right
        // before the fetch; if it throws after that, the value is lost.
        // Add 1 to preserve the "attempt initiated" semantic. (Risk of
        // over-count is only if executeSearch throws BEFORE reaching
        // its increment site — synchronous error in URL construction —
        // which has no observed path today.)
        queriesExecuted++;
        console.error(`[SocialUnified] Search error for ${search.sourceName}:`, error);
      }
    }

    console.log(`[SocialUnified] Complete. Searches: ${totalSearches}, Signals: ${signalsCreated}, AI-rejected: ${aiRejected}`);
    console.log(`[SocialUnified] Rejection breakdown:`, rejectionCounters);

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      searches: totalSearches,
      ai_rejected: aiRejected,                     // legacy aggregate — keep for backward compat
      budget_remaining: searchBudgetRemaining,
      rejection_counters: rejectionCounters,       // PROD-H — per-stage breakdown
      rejection_samples: rejectionSamples,         // PROD-H — up to 3 examples per stage
      // PROD-N Tranche A (2026-05-22) — typed telemetry shape fields.
      //
      // INTENTIONAL semantic separation from `searches`:
      //   - `searches` (= totalSearches) counts CSE search-queue iterations
      //     incremented at line 478 BEFORE the actual fetch attempt.
      //     Reflects "search slots consumed" including any that broke
      //     pre-fetch.
      //   - `queries_executed` counts every upstream fetch ACTUALLY
      //     INITIATED — incremented immediately BEFORE the fetch call
      //     (CSE + 4 Meta Graph endpoints). Includes HTTP errors, 429s,
      //     timeouts, network exceptions, and successes. Excludes calls
      //     that never reached the fetch site.
      //
      // Watchdog Rule C ("scope gap, 0 queries built") fires on
      // queries_executed = 0 specifically. Initiated semantic prevents
      // false Rule C classifications from transient network failures.
      queries_executed: queriesExecuted,
      distinct_clients_iterated: clients.slice(0, 4).length,
      fixture_clients_iterated: excludedFixtures,
    });

    return successResponse({
      success: true,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      ai_rejected: aiRejected,
      budget_remaining: searchBudgetRemaining,
      rejection_counters: rejectionCounters,
      rejection_samples: rejectionSamples,
      source: 'social-unified'
    });

  } catch (error) {
    console.error('[SocialUnified] Fatal error:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Diagnostic instrumentation (added 2026-05-22 — Petronas-era scope
// audit). Purely additive: the existing `signals` and `rejected`
// returns are preserved; new typed counters + per-stage samples are
// returned alongside them. No threshold or filter behavior changes.
// All call sites of executeSearch must aggregate the new fields.
//
// Goal: empirically attribute every dropped candidate to a specific
// stage, with a sampled query/URL/snippet so the operator can see
// what is actually being rejected and where.
// ═══════════════════════════════════════════════════════════════

interface RejectionCounters {
  items_returned: number;       // CSE items returned (pre-filter)
  empty_payload: number;        // searches that returned 0 items
  http_error: number;           // CSE non-200 (excluding 429 which throws)
  short_or_dup_url: number;     // line ~491: !url || dup || content<30
  blocked_domain: number;       // line ~497: BLOCKED_DOMAINS hit
  wikipedia: number;            // line ~520
  old_url_year: number;         // line ~531: URL contains pre-2025 year
  old_snippet_date: number;     // line ~536: snippet has pre-2025 date
  non_canadian_xr: number;      // line ~546
  generic_fb_profile: number;   // line ~561
  generic_x_profile: number;    // line ~566
  generic_ig_profile: number;   // line ~571
  ai_rejected: number;          // line ~580: AI gate verdict.relevant=false
  duplicate_db: number;         // line ~592: ingested_documents already has URL
  signals_created: number;      // mirrors signals counter, for completeness
}

interface RejectionSample {
  stage: string;
  reason?: string;
  query: string;
  platform: string;
  source_name: string;
  source_type: 'client' | 'entity';
  url: string;
  title: string;     // truncated to 80 chars
  snippet: string;   // truncated to 200 chars
}

const MAX_SAMPLES_PER_STAGE = 3;

function newRejectionCounters(): RejectionCounters {
  return {
    items_returned: 0, empty_payload: 0, http_error: 0,
    short_or_dup_url: 0, blocked_domain: 0, wikipedia: 0,
    old_url_year: 0, old_snippet_date: 0, non_canadian_xr: 0,
    generic_fb_profile: 0, generic_x_profile: 0, generic_ig_profile: 0,
    ai_rejected: 0, duplicate_db: 0, signals_created: 0,
  };
}

function mergeCounters(into: RejectionCounters, from: RejectionCounters): void {
  for (const k of Object.keys(into) as (keyof RejectionCounters)[]) {
    into[k] += from[k];
  }
}

function addSampleIfRoom(
  bucket: RejectionSample[],
  stage: keyof RejectionCounters,
  fields: Omit<RejectionSample, 'stage'>,
): void {
  const existingForStage = bucket.filter(s => s.stage === stage).length;
  if (existingForStage >= MAX_SAMPLES_PER_STAGE) return;
  bucket.push({
    stage,
    ...fields,
    title: (fields.title || '').substring(0, 80),
    snippet: (fields.snippet || '').substring(0, 200),
  });
}

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
    monitoringConfig?: any;  // PROD-H: archetype context (JSONB) for this search
  },
  processedUrls: Set<string>
): Promise<{ signals: number; rejected: number; counters: RejectionCounters; samples: RejectionSample[]; queries_executed: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let signals = 0;
  let rejected = 0;
  const counters = newRejectionCounters();
  const samples: RejectionSample[] = [];
  // PROD-N Tranche A (2026-05-22): "upstream attempt initiated" counter.
  // Set to 1 IMMEDIATELY BEFORE the fetch call so it survives every
  // outcome — HTTP error, 429 (which throws), timeout, network exception,
  // or success. Returned to the caller for accumulation. If the function
  // throws before reaching the return statement (rate-limit / network),
  // the caller adds a fallback +1 in its catch block to preserve count
  // integrity (see outer loop).
  let queriesExecutedThisCall = 0;

  try {
    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(search.query)}&num=5`;

    queriesExecutedThisCall = 1;
    const response = await fetch(apiUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      if (response.status === 429) throw new RateLimitError();
      console.log(`[SocialUnified] Search failed: ${response.status}`);
      counters.http_error++;
      addSampleIfRoom(samples, 'http_error', {
        reason: `HTTP ${response.status}`,
        query: search.query, platform: search.platform,
        source_name: search.sourceName, source_type: search.sourceType,
        url: '', title: '', snippet: '',
      });
      return { signals: 0, rejected: 0, counters, samples, queries_executed: queriesExecutedThisCall };
    }

    const data = await response.json();
    const items = data.items || [];
    counters.items_returned += items.length;
    if (items.length === 0) {
      counters.empty_payload++;
      addSampleIfRoom(samples, 'empty_payload', {
        reason: 'CSE returned 0 items',
        query: search.query, platform: search.platform,
        source_name: search.sourceName, source_type: search.sourceType,
        url: '', title: '', snippet: '',
      });
    }

    for (const item of items.slice(0, 5)) {
      if (isTimeUp()) break;

      const url = item.link || '';
      const title = item.title || '';
      const snippet = item.snippet || '';
      const domain = item.displayLink || '';
      const content = `${title} ${snippet}`.trim();

      // Skip if already processed or too short
      if (!url || processedUrls.has(url) || content.length < 30) {
        counters.short_or_dup_url++;
        addSampleIfRoom(samples, 'short_or_dup_url', {
          reason: !url ? 'empty url' : (processedUrls.has(url) ? 'already processed this run' : `content.length=${content.length} < 30`),
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
        continue;
      }
      processedUrls.add(url);

      // Domain blocklist
      if (BLOCKED_DOMAINS.some(d => domain.includes(d))) {
        console.log(`[SocialUnified] Blocked domain: ${domain}`);
        counters.blocked_domain++;
        addSampleIfRoom(samples, 'blocked_domain', {
          reason: `blocklist match: ${domain}`,
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
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
        counters.wikipedia++;
        addSampleIfRoom(samples, 'wikipedia', {
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
        continue;
      }

      if (!isEntityScan) {
        const oldYearPattern = /\b(201[0-9]|202[0-3]|2024)\b/;
        const urlHasOldYear = oldYearPattern.test(url);
        const snippetDateContext = snippet.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*(201[0-9]|202[0-4])\b/i);

        if (urlHasOldYear && !url.includes('2025') && !url.includes('2026')) {
          console.log(`[SocialUnified] ✗ Old content filtered (campaign scan): "${title.substring(0, 50)}"`);
          rejected++;
          counters.old_url_year++;
          addSampleIfRoom(samples, 'old_url_year', {
            reason: 'URL contains pre-2025 year token',
            query: search.query, platform: search.platform,
            source_name: search.sourceName, source_type: search.sourceType,
            url, title, snippet,
          });
          continue;
        }
        if (snippetDateContext) {
          console.log(`[SocialUnified] ✗ Old snippet date (campaign scan): "${snippetDateContext[0]}" in "${title.substring(0, 50)}"`);
          rejected++;
          counters.old_snippet_date++;
          addSampleIfRoom(samples, 'old_snippet_date', {
            reason: `snippet date match: ${snippetDateContext[0]}`,
            query: search.query, platform: search.platform,
            source_name: search.sourceName, source_type: search.sourceType,
            url, title, snippet,
          });
          continue;
        }
      }

      // ═══ HARD GEOGRAPHIC FILTER ═══
      // Reject non-Canadian XR chapters explicitly
      const nonCanadianXR = /(extinction rebellion)\s+(austria|germany|uk|cape town|australia|netherlands|sweden|norway|france|italy|spain|japan)/i;
      if (nonCanadianXR.test(content)) {
        console.log(`[SocialUnified] ✗ Non-Canadian XR: "${title.substring(0, 50)}"`);
        rejected++;
        counters.non_canadian_xr++;
        addSampleIfRoom(samples, 'non_canadian_xr', {
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
        continue;
      }

      // Skip generic profile pages for campaign scans across ALL three
      // platforms. Profile URLs (e.g. x.com/EnergeticCity) point at a
      // user's main page, not a specific post — so the resulting "signal"
      // tells the operator "Energetic City exists" instead of "Energetic
      // City posted X". Operator caught a case where the underlying
      // wildfire tweet was the actual intel, but the signal source URL
      // was the profile page. Only entity scans bypass this — those
      // legitimately want bio/contact data from a profile page.
      //
      // PROD-H exception: if the URL handle MATCHES the searched
      // client/source name (e.g. https://x.com/bcplace when searching
      // for "BC Place"), this is the protected entity's OWN channel
      // and IS mission-relevant for venue / VIP / event archetypes.
      // Without this exception, the venue's official feed (the most
      // important social source for CRT) was being killed. Diagnostic
      // 2026-05-22 captured @bcplace, @bcplacestadium being rejected.
      if (!isEntityScan) {
        const ownedByClient = isOwnedProfileFor(url, search.sourceName);
        if (!ownedByClient && url.includes('facebook.com') && !isSpecificFacebookUrl(url)) {
          console.log(`[SocialUnified] ✗ Generic FB profile (campaign scan): ${url}`);
          rejected++;
          counters.generic_fb_profile++;
          addSampleIfRoom(samples, 'generic_fb_profile', {
            query: search.query, platform: search.platform,
            source_name: search.sourceName, source_type: search.sourceType,
            url, title, snippet,
          });
          continue;
        }
        if (!ownedByClient && (url.includes('x.com') || url.includes('twitter.com')) && !isSpecificXUrl(url)) {
          console.log(`[SocialUnified] ✗ Generic X profile (campaign scan): ${url}`);
          rejected++;
          counters.generic_x_profile++;
          addSampleIfRoom(samples, 'generic_x_profile', {
            query: search.query, platform: search.platform,
            source_name: search.sourceName, source_type: search.sourceType,
            url, title, snippet,
          });
          continue;
        }
        if (!ownedByClient && url.includes('instagram.com') && !isSpecificInstagramUrl(url)) {
          console.log(`[SocialUnified] ✗ Generic IG profile (campaign scan): ${url}`);
          rejected++;
          counters.generic_ig_profile++;
          addSampleIfRoom(samples, 'generic_ig_profile', {
            query: search.query, platform: search.platform,
            source_name: search.sourceName, source_type: search.sourceType,
            url, title, snippet,
          });
          continue;
        }
      }

      // ═══ AI RELEVANCE GATE ═══
      // PROD-H: client-scope branch is archetype-keyed via monitoringConfig.
      // Entity-scope branch keeps the subject-agnostic prompt (unchanged).
      const aiVerdict = await aiRelevanceGate(title, snippet, url, search.sourceName, search.platform, isEntityScan, search.monitoringConfig ?? null);
      if (!aiVerdict.relevant) {
        console.log(`[SocialUnified] ✗ AI rejected: "${title.substring(0, 60)}" — ${aiVerdict.reason}`);
        rejected++;
        counters.ai_rejected++;
        addSampleIfRoom(samples, 'ai_rejected', {
          reason: aiVerdict.reason,
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
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
        counters.duplicate_db++;
        addSampleIfRoom(samples, 'duplicate_db', {
          reason: 'URL already in ingested_documents',
          query: search.query, platform: search.platform,
          source_name: search.sourceName, source_type: search.sourceType,
          url, title, snippet,
        });
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
        counters.signals_created++;
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

  return { signals, rejected, counters, samples, queries_executed: queriesExecutedThisCall };
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
  isEntityScan: boolean = false,
  // PROD-H: monitoring_config drives which archetype prompt is used for
  // CLIENT-scope searches. Null is acceptable and resolves to the default
  // (energy_infrastructure) inside the archetypes module. The entity-scope
  // branch is intentionally subject-agnostic and ignores monitoringConfig.
  monitoringConfig: any = null,
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
    // PROD-H: client-scope prompt resolves from monitoringConfig.archetype.
    // Replaces the hardcoded "Canadian energy infrastructure" framing that
    // was rejecting real CRT-relevant signals (FIFA protests, BC Place
    // threats) as off-topic. The archetypes module owns the prompt body
    // per archetype — see _shared/archetypes.ts.
    : getClientAiSystemPrompt(monitoringConfig, sourceName);

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

// X / Twitter individual-post URL test. Bare profile URLs like
// x.com/<handle> with no /status/<id> after are not actionable — they
// point at the user's main page, not a specific tweet.
function isSpecificXUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\/status\/\d+/.test(lower)
      || /\/i\/(?:web\/)?status\//.test(lower)
      || /\/photo\//.test(lower)
      || /\/video\//.test(lower)
      || /\/spaces\//.test(lower);
}

// Instagram individual-post URL test. /p/<shortcode>, /reel/<shortcode>,
// /tv/<shortcode>, /stories/<user>/<id> are all post-specific. Bare
// profile URLs like instagram.com/<handle> are filtered.
function isSpecificInstagramUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\/p\/[a-z0-9_-]+/i.test(lower)
      || /\/reel\/[a-z0-9_-]+/i.test(lower)
      || /\/tv\/[a-z0-9_-]+/i.test(lower)
      || /\/stories\//.test(lower);
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
