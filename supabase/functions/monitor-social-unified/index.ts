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
  { name: 'twitter',   sites: ['site:x.com', 'site:twitter.com'], label: 'Twitter/X' },
  { name: 'facebook',  sites: ['site:facebook.com'],              label: 'Facebook' },
  { name: 'instagram', sites: ['site:instagram.com'],             label: 'Instagram' },
  { name: 'linkedin',  sites: ['site:linkedin.com'],              label: 'LinkedIn' },
  { name: 'reddit',    sites: ['site:reddit.com'],                label: 'Reddit' },
  { name: 'youtube',   sites: ['site:youtube.com'],               label: 'YouTube' },
  { name: 'tiktok',    sites: ['site:tiktok.com'],                label: 'TikTok' },
] as const;

// Canadian and international news domains for news monitoring
const NEWS_SITES = [
  'site:cbc.ca', 'site:globeandmail.com', 'site:nationalpost.com',
  'site:thestar.com', 'site:calgaryherald.com', 'site:vancouversun.com',
  'site:edmontonjournal.com', 'site:montrealgazette.com', 'site:theglobeandmail.com',
  'site:reuters.com', 'site:apnews.com', 'site:bloomberg.com',
  'site:financialpost.com', 'site:bnnbloomberg.ca',
];

// Cyber/security threat keywords
const SECURITY_KEYWORDS = [
  'data breach', 'hack', 'ransomware', 'malware', 'vulnerability', 'exploit',
  'zero-day', 'phishing', 'ddos', 'cyber attack', 'cyberattack', 'backdoor',
  'trojan', 'botnet', 'apt', 'threat actor', 'compromise', 'exfiltration',
  'lateral movement', 'privilege escalation', 'credential', 'dark web',
];

// Physical threat / sabotage keywords
const PHYSICAL_THREAT_KEYWORDS = [
  'sabotage', 'tree-spiking', 'tree spike', 'infrastructure attack',
  'valve turner', 'monkey wrench', 'direct action', 'lock down', 'lockdown',
  'chain', 'tripod', 'blockade tactics', 'equipment damage', 'trespassing',
  'illegal entry', 'security breach', 'arson', 'vandalism', 'bomb threat',
];

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
  'eventbrite.com', 'pinterest.com', 'etsy.com',
  'amazon.com', 'ebay.com', 'spotify.com', 'soundcloud.com',
  'yelp.com', 'tripadvisor.com', 'imdb.com'
];

// Custom error to signal rate limit bail-out
class RateLimitError extends Error {
  constructor() { super('Google API rate limited'); this.name = 'RateLimitError'; }
}

// Execution ceiling to prevent 504 Gateway Timeouts
const EXECUTION_CEILING_MS = 100_000;
const startTime = Date.now();
function isTimeUp(): boolean { return Date.now() - startTime > EXECUTION_CEILING_MS; }

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

    const hasGoogle = !!(apiKey && engineId);
    const hasPerplexity = !!PERPLEXITY_API_KEY;

    if (!hasGoogle && !hasPerplexity) {
      console.log('[SocialUnified] No search API configured (Google CSE or Perplexity), skipping');
      return successResponse({ success: true, message: 'No search API configured', signals_created: 0 });
    }

    console.log(`[SocialUnified] Starting unified OSINT monitoring... (Google: ${hasGoogle}, Perplexity: ${hasPerplexity})`);

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

    // Sort entities by risk priority: critical → high → medium → low → null
    const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    entities.sort((a, b) => {
      const ra = RISK_ORDER[a.risk_level] ?? 4;
      const rb = RISK_ORDER[b.risk_level] ?? 4;
      return ra - rb;
    });

    console.log(`[SocialUnified] ${clients.length} clients, ${entities.length} entities (sorted by risk priority)`);

    // ═══ SEARCH BUDGET ═══
    const MAX_SEARCHES = 50;
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

    // Client queries — social + news coverage per client
    for (const client of clients.slice(0, 4)) {
      const threatTerms = '(protest OR blockade OR breach OR hack OR activist OR threat OR attack OR sabotage OR leak)';

      // Social platforms
      for (const platform of PLATFORMS) {
        searchQueue.push({
          query: `${platform.sites[0]} "${client.name}" ${threatTerms}`,
          platform: platform.name,
          sourceName: client.name,
          sourceType: 'client',
          clientId: client.id,
          entityId: null,
        });
      }

      // Canadian + international news for this client
      const newsSiteFilter = NEWS_SITES.join(' OR ');
      searchQueue.push({
        query: `(${newsSiteFilter}) "${client.name}"`,
        platform: 'news',
        sourceName: client.name,
        sourceType: 'client',
        clientId: client.id,
        entityId: null,
      });

      // Broad Google News (no site filter — catches any outlet)
      searchQueue.push({
        query: `"${client.name}" ${threatTerms}`,
        platform: 'news',
        sourceName: client.name,
        sourceType: 'client',
        clientId: client.id,
        entityId: null,
      });
    }

    // Entity queries — handle-based + name-mention across all platforms
    for (const entity of entities.slice(0, 20)) {
      const attrs = entity.attributes || {};
      const isPerson = entity.type === 'person';
      const q = entity.name; // shorthand for quoted name searches

      // ── Twitter/X ──────────────────────────────────────────
      const twitterHandle = attrs.twitter_handle || attrs.x_handle ||
        entity.aliases?.find((a: string) => a.startsWith('@'));
      if (twitterHandle) {
        const clean = twitterHandle.replace('@', '');
        searchQueue.push({ query: `site:x.com/${clean}`, platform: 'twitter', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }
      // Name-mention (catches posts by others — critical for executive monitoring)
      searchQueue.push({ query: `site:x.com "${q}"`, platform: 'twitter', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── Facebook ───────────────────────────────────────────
      const fbHandle = attrs.facebook_page || attrs.facebook_handle;
      if (fbHandle) {
        searchQueue.push({ query: `site:facebook.com/${fbHandle}`, platform: 'facebook', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }
      if (isPerson) {
        searchQueue.push({ query: `site:facebook.com "${q}"`, platform: 'facebook', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }

      // ── Instagram ──────────────────────────────────────────
      const igHandle = attrs.instagram_handle;
      if (igHandle) {
        const clean = igHandle.replace('@', '');
        searchQueue.push({ query: `site:instagram.com/${clean}`, platform: 'instagram', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }

      // ── LinkedIn ───────────────────────────────────────────
      const liHandle = attrs.linkedin_url || attrs.linkedin_handle;
      if (liHandle) {
        searchQueue.push({ query: `site:linkedin.com/in/${liHandle.replace(/.*\/in\//, '')}`, platform: 'linkedin', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }
      // LinkedIn name-mention (posts, articles, comments about the person/org)
      searchQueue.push({ query: `site:linkedin.com "${q}"`, platform: 'linkedin', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── Reddit ─────────────────────────────────────────────
      searchQueue.push({ query: `site:reddit.com "${q}"`, platform: 'reddit', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── YouTube ────────────────────────────────────────────
      searchQueue.push({ query: `site:youtube.com "${q}"`, platform: 'youtube', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── TikTok (persons — high exposure for executive targeting) ──
      if (isPerson) {
        searchQueue.push({ query: `site:tiktok.com "${q}"`, platform: 'tiktok', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
      }

      // ── News (broad Google index — catches any news source) ────────
      const newsIntent = isPerson
        ? `"${q}" (scandal OR controversy OR fired OR lawsuit OR allegation OR accused OR misconduct OR resign)`
        : `"${q}" (breach OR hack OR protest OR blockade OR leak OR incident OR attack OR threat)`;
      searchQueue.push({ query: newsIntent, platform: 'news', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── Canadian news sites specifically ───────────────────
      const newsSiteFilter = NEWS_SITES.slice(0, 3).join(' OR '); // top 3 per entity to conserve budget
      searchQueue.push({ query: `(${newsSiteFilter}) "${q}"`, platform: 'news', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });

      // ── Pastebin / leak detection ──────────────────────────
      // Catches credential dumps, internal document leaks, manifestos
      searchQueue.push({ query: `site:pastebin.com "${q}"`, platform: 'pastebin', sourceName: q, sourceType: 'entity', clientId: null, entityId: entity.id });
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

    // ═══ GOOGLE CSE SEARCH QUEUE (if configured) ═══
    if (hasGoogle) {
      for (const search of searchQueue) {
        if (searchBudgetRemaining <= 0 || isTimeUp()) {
          console.log(`[SocialUnified] Google: stopping — budget=${searchBudgetRemaining}, timeUp=${isTimeUp()}`);
          break;
        }
        try {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
          totalSearches++;
          searchBudgetRemaining--;
          const result = await executeSearch(supabase, apiKey!, engineId!, search, processedUrls);
          signalsCreated += result.signals;
          aiRejected += result.rejected;
        } catch (error) {
          if (error instanceof RateLimitError) {
            console.log('[SocialUnified] Google rate limited — stopping CSE searches');
            break;
          }
          console.error(`[SocialUnified] Google search error for ${search.sourceName}:`, error);
        }
      }
    }

    // ═══ PERPLEXITY SONAR (primary when Google CSE not configured, supplemental otherwise) ═══
    if (hasPerplexity && !isTimeUp()) {
      let perplexitySignals = 0;

      // Clients — threat intelligence query
      for (const client of clients.slice(0, 5)) {
        if (isTimeUp()) break;
        try {
          await new Promise(r => setTimeout(r, 2000));
          const query = `Search across ALL platforms (Twitter/X, LinkedIn, Facebook, Instagram, Reddit, YouTube, TikTok, news sites, forums) for recent (last 30 days) posts, articles, or discussions about "${client.name}" related to: security threats, data breaches, hacks, ransomware, protests, blockades, activist campaigns, boycotts, sabotage, insider threats, leaked documents, or reputational attacks. Include specific post content, notable replies/comments on those posts, and URLs where available. If a post has significant comments or replies that reveal additional threat context, include those too.`;
          const result = await perplexitySearch(PERPLEXITY_API_KEY!, query, client.name, client.id, null, supabase);
          perplexitySignals += result;
          totalSearches++;
        } catch (e) {
          console.error(`[SocialUnified] Perplexity error for client ${client.name}:`, e);
        }
      }

      // Entities (executives, orgs) — targeted monitoring
      for (const entity of entities.slice(0, 20)) {
        if (isTimeUp()) break;
        try {
          await new Promise(r => setTimeout(r, 2000));
          const isPerson = entity.type === 'person';
          const attrs = entity.attributes || {};
          const titleStr = attrs.title ? ` (${attrs.title}` + (attrs.organization ? ` at ${attrs.organization})` : ')') : '';

          const query = isPerson
            ? `Search across ALL social media platforms (Twitter/X, LinkedIn, Facebook, Instagram, Reddit, YouTube, TikTok) and news sites for recent (last 30 days) posts or articles mentioning "${entity.name}"${titleStr}. Focus on: threats against this person, "name and shame" campaigns, coordinated harassment, leaked internal documents or emails attributed to them or their organization, public controversies, misconduct allegations, legal actions, or reputational attacks. Include direct quotes, source URLs, AND notable replies or comments on those posts — especially if comments escalate the threat or reveal broader coordinated activity.`
            : `Search across ALL platforms and news for recent (last 30 days) mentions of "${entity.name}" related to: security incidents, data breaches, activist campaigns, protests, leaks, threats, or reputational risks. Include source URLs and any significant comment threads or replies that provide additional context.`;

          const result = await perplexitySearch(PERPLEXITY_API_KEY!, query, entity.name, null, entity.id, supabase);
          perplexitySignals += result;
          totalSearches++;
        } catch (e) {
          console.error(`[SocialUnified] Perplexity error for entity ${entity.name}:`, e);
        }
      }

      // Broad activism campaign sweep
      const campaignQuery = `Search Twitter/X, Reddit, Facebook, and news sites for recent (last 7 days) posts about anti-pipeline campaigns, LNG protests, or energy infrastructure activism in Canada. Keywords: Coastal GasLink, LNG Canada, Cedar LNG, Wet'suwet'en, pipeline blockade, pipeline protest, Shut Down Canada, land defenders, stand.earth, Dogwood BC. Return specific post content, URLs, and any significant replies or comment threads that show coordination, escalation, or broader support.`;
      if (!isTimeUp()) {
        try {
          await new Promise(r => setTimeout(r, 2000));
          const result = await perplexitySearch(PERPLEXITY_API_KEY!, campaignQuery, 'Industry Campaign Monitor', null, null, supabase);
          perplexitySignals += result;
          totalSearches++;
        } catch (e) {
          console.error('[SocialUnified] Perplexity campaign sweep error:', e);
        }
      }

      signalsCreated += perplexitySignals;
      console.log(`[SocialUnified] Perplexity: ${perplexitySignals} signals`);
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
// Perplexity Sonar search — real-time web + social intelligence
// ═══════════════════════════════════════════════════════════════

const NEGATIVE_INDICATORS = [
  // "cannot find" variants — Perplexity often omits "any"
  'i cannot find information', 'i cannot find any information', 'cannot find information',
  'i could not find', 'i did not find', 'i was unable to find', 'unable to find',
  'could not find', 'i cannot locate', 'i am unable to find',
  // "no X found/available"
  'no recent', 'no specific', 'no information about', 'no information regarding',
  'no relevant', 'no evidence of', 'no reports of', 'no mentions of',
  'no data about', 'no significant', 'no results', 'nothing found',
  'no threats', 'no incidents', 'no breaches', 'no protests',
  'no news about', 'no public discussions', 'no social media', 'not found any',
  'no direct', 'no particular', 'no actionable', 'no matching',
  'no indication of', 'no mention of',
  // "do not contain" variants
  'do not contain', 'does not contain', 'the search results do not',
  // "there is no" variants
  'there is no information', 'there are no reports', 'there are no specific',
  'there is no specific', 'there is no evidence', 'there are no known',
  'there doesn\'t appear to be', 'there does not appear to be',
  'there is currently no', 'there are currently no',
  // "not aware / not identified"
  'not aware of any', 'i cannot identify', 'cannot identify any',
  // generic empty-result phrases
  'no relevant information', 'no specific information',
  'i found no evidence', 'based on my search', 'as of my knowledge cutoff',
  'i don\'t have information', 'i do not have information',
  'as of the latest available', 'no publicly available information',
];

async function perplexitySearch(
  apiKey: string,
  query: string,
  sourceName: string,
  clientId: string | null,
  entityId: string | null,
  supabase: any
): Promise<number> {
  const resp = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: query }],
      max_tokens: 800,
    }),
  });

  if (!resp.ok) {
    console.log(`[Perplexity] Request failed: ${resp.status}`);
    return 0;
  }

  const data = await resp.json();
  const content: string = data.choices?.[0]?.message?.content || '';
  const contentLower = content.toLowerCase();

  // Suppress "no results" responses — Perplexity echoes query keywords in negatives
  const isNegative = NEGATIVE_INDICATORS.some(p => contentLower.includes(p));
  if (isNegative || content.length < 100) {
    console.log(`[Perplexity] No actionable intel for "${sourceName}"`);
    return 0;
  }

  // Check for insider threat indicators first — fast-path to P1
  const isInsiderThreat = /leaked.{0,30}(internal|document|email|screenshot|confidential)|internal.{0,30}(document|email|screenshot).{0,30}(post|public|share|leak)|name.and.shame.{0,50}(ceo|coo|vp|director|executive)/i.test(content);

  // Classify content
  const hasCyber = SECURITY_KEYWORDS.some(k => contentLower.includes(k.toLowerCase()));
  const hasPhysical = PHYSICAL_THREAT_KEYWORDS.some(k => contentLower.includes(k.toLowerCase()));
  const hasActivism = ACTIVISM_KEYWORDS.some(k => contentLower.includes(k.toLowerCase())) ||
    /protest|blockade|boycott|campaign|activist/i.test(content);
  const hasReputational = /scandal|controvers|allegat|misconduct|fired|lawsuit|accus|name.and.shame|resign/i.test(content);

  const hasAnyThreat = isInsiderThreat || hasCyber || hasPhysical || hasActivism || hasReputational;
  if (!hasAnyThreat) {
    console.log(`[Perplexity] No threat keywords in response for "${sourceName}"`);
    return 0;
  }

  let category = 'social_media';
  let severity = 'low';
  if (isInsiderThreat) { category = 'insider_threat'; severity = 'critical'; }
  else if (hasCyber) { category = 'cybersecurity'; severity = 'medium'; }
  else if (hasPhysical) { category = 'physical'; severity = 'high'; }
  else if (hasActivism) { category = 'activism'; severity = 'medium'; }
  else if (hasReputational) { category = 'reputational_risk'; severity = 'medium'; }

  const citations: string[] = data.citations || [];
  const primaryUrl = citations[0] || null;

  // Extract comment/reply snippets from Perplexity response
  // Perplexity may mention replies inline — extract sentences that describe comments/replies
  const commentMatches = content.match(
    /(?:repl(?:ied|ies|y)|comment(?:ed|s|ing)|respond(?:ed|s)|in response|one user (?:wrote|said|noted)|several users|thread (?:includes|shows|contains))[^.!?]*[.!?]/gi
  ) || [];
  const extractedComments = commentMatches.slice(0, 5).map((c, i) => ({
    id: `perplexity_comment_${i}`,
    text: c.trim(),
    source: 'perplexity_extracted',
  }));

  // Insert signal
  const { error: sigErr } = await supabase.from('signals').insert({
    client_id: clientId,
    normalized_text: `[OSINT/${category.toUpperCase()}] ${sourceName}: ${content.substring(0, 500)}`,
    signal_type: 'social',
    category,
    severity,
    confidence: 0.70,
    location: 'Multi-Platform (Perplexity Sonar)',
    entity_tags: entityId ? [sourceName] : [],
    source_url: primaryUrl,
    comments: extractedComments.length > 0 ? extractedComments : null,
    raw_data: {
      platform: 'perplexity_sonar',
      source: 'multi_platform_search',
      source_url: primaryUrl,
      citations,
      full_content: content.substring(0, 2000),
      entity_id: entityId,
      comment_count: extractedComments.length,
    },
  });

  if (sigErr) {
    console.error(`[Perplexity] Signal insert error for "${sourceName}":`, sigErr.message);
    return 0;
  }

  // Link to entity
  if (entityId) {
    await supabase.from('document_entity_mentions').insert({
      entity_id: entityId,
      confidence: 0.75,
      mention_text: sourceName,
    }).then(() => {}).catch(() => {});
  }

  // Insider threat fast-path: create P1 incident immediately
  if (isInsiderThreat) {
    console.log(`[Perplexity] ⚠️ INSIDER THREAT detected for "${sourceName}" — escalating to P1`);
    await supabase.from('incidents').insert({
      title: `INSIDER THREAT: Leaked internal content detected — ${sourceName}`,
      description: `Perplexity Sonar detected what appears to be leaked internal documents, emails, or communications published publicly.\n\nContent summary: ${content.substring(0, 800)}\n\nCitations: ${citations.join(', ')}`,
      severity_level: 'critical',
      priority: 'p1',
      status: 'open',
      client_id: clientId,
      metadata: { category: 'insider_threat', source: 'perplexity_sonar', entity_id: entityId, citations, fast_path: true, requires_immediate_review: true },
    }).then(() => {}).catch(() => {});
  }

  console.log(`[Perplexity] ✓ Signal created for "${sourceName}" — ${category}/${severity}`);
  return 1;
}

// ═══════════════════════════════════════════════════════════════
// Core Google CSE search + ingest pipeline
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
      if (url.includes('pastebin.com')) {
        category = 'leak_detection';
      } else if (platform === 'News' || platform === 'news') {
        category = 'news_media';
      } else if (lowerContent.includes('protest') || lowerContent.includes('blockade') || lowerContent.includes('demonstration')) {
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

        // INSIDER THREAT FAST-PATH: bypass normal pipeline, create P1 incident immediately
        if (aiVerdict.category === 'insider_threat') {
          console.log(`[SocialUnified] ⚠️ INSIDER THREAT DETECTED — fast-pathing to P1 incident`);

          // Create signal directly
          const { data: signal } = await supabase.from('signals').insert({
            normalized_text: `INSIDER THREAT: Leaked internal documents/communications detected publicly on ${platform}. Source: ${url}. Content: ${content.substring(0, 500)}`,
            category: 'insider_threat',
            severity: 'critical',
            confidence: aiVerdict.confidence || 0.95,
            location: aiVerdict.location || 'Unknown',
            entity_tags: search.entityId ? [search.sourceName] : [],
            client_id: search.clientId,
            source_url: url,
            raw_data: { document_id: doc.id, ai_verdict: aiVerdict, platform, post_url: url }
          }).select().single();

          if (signal) {
            // Create P1 incident immediately — do not wait for scoring
            await supabase.from('incidents').insert({
              title: `INSIDER THREAT: Leaked internal content detected on ${platform} — ${search.sourceName}`,
              description: `An employee or insider has published what appears to be internal company documents, screenshots, or confidential communications on ${platform}.\n\nURL: ${url}\n\nContent preview: ${content.substring(0, 800)}\n\nAI assessment: ${aiVerdict.reason}`,
              severity_level: 'critical',
              priority: 'p1',
              status: 'open',
              signal_id: signal.id,
              client_id: search.clientId,
              assigned_to: null,
              metadata: {
                category: 'insider_threat',
                source_platform: platform,
                source_url: url,
                entity_id: search.entityId,
                entity_name: search.sourceName,
                ai_confidence: aiVerdict.confidence,
                fast_path: true,
                requires_immediate_review: true
              }
            });

            // Log to autonomous actions
            await supabase.from('autonomous_actions_log').insert({
              agent_call_sign: 'SOCIAL-MONITOR',
              action_type: 'insider_threat_detected',
              action_description: `P1 insider threat incident auto-created from ${platform} post. Leaked internal content detected publicly. Immediate review required.`,
              target_entity: search.sourceName,
              outcome: 'p1_incident_created',
              confidence_score: aiVerdict.confidence || 0.95,
              metadata: { signal_id: signal.id, source_url: url, platform }
            });
          }
        } else {
          // Normal path — trigger intelligence processing
          await supabase.functions.invoke('process-intelligence-document', {
            body: { documentId: doc.id }
          });
        }

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
          content: `You are an intelligence analyst filtering social media search results for a corporate security team.
You must determine if this result is OPERATIONALLY RELEVANT to security monitoring for clients — including Canadian energy infrastructure clients (pipelines, LNG facilities, energy companies) AND their executives, personnel, and organizational reputation.

CRITICAL TEMPORAL RULE: Reject any content where the original post or event date is MORE THAN 90 DAYS OLD. Look for date indicators in the snippet, title, or URL (e.g., "2019", "2021", "6 years ago", "posted on December 2019"). Old social media posts resurfacing via search engines are NOT actionable intelligence.

CRITICAL GEOGRAPHIC RULE: Reject content about protests, activism, or events that physically occurred OUTSIDE of Canada, even if the organization name matches (e.g., "Extinction Rebellion Austria", "XR Cape Town", "XR Germany" are NOT relevant). Only Canadian-occurring events qualify. EXCEPTION: Reputational risk content about named executives or personnel is relevant regardless of geography.

A result is relevant if it:
- Describes RECENT (within 90 days) activism, protests, blockades, or sabotage targeting energy infrastructure
- Mentions a specific threat, breach, or security incident related to the monitored entity
- Is a specific social media POST (not a generic profile page, directory listing, or unrelated content)
- Physically relates to Canadian geography or Canadian energy companies
- Has a discernible date that is recent (within the last 90 days)
- REPUTATIONAL RISK: Mentions a named executive, current or former employee, or key personnel of the monitored organization in a context that could harm the organization's reputation (controversies, public criticism, legal issues, misconduct allegations, policy disputes)
- PERSONNEL THREATS: Discusses threats against, harassment of, or coordinated campaigns targeting specific company executives or employees ("name and shame", doxxing, organized harassment)
- CORPORATE REPUTATION: Discusses boycotts, public campaigns, or coordinated efforts specifically targeting the monitored organization or its leadership
- INSIDER THREAT (HIGHEST PRIORITY): Post appears to contain or reference leaked internal documents, internal emails, screenshots of internal company systems, or confidential internal communications published without authorization. This includes any post where someone claims to have or shows internal company information.

INSIDER THREAT ESCALATION RULE: If the post shows evidence of leaked internal documents, internal screenshots, or confidential company communications — mark relevant=true, category="insider_threat", confidence=0.95 regardless of other criteria. This overrides all other rules including geographic and temporal filters.

A result is NOT relevant if it:
- Is about unrelated topics that happen to match keywords (e.g., "pipeline" in software, unrelated protests)
- Is a generic page, profile, or directory listing
- Is international news with no Canadian connection AND no named personnel connection
- Is entertainment, marketing, or spam content
- References events from years ago (2019, 2020, 2021, 2022, 2023, early 2024)
- Is about Extinction Rebellion chapters outside Canada (Austria, Germany, UK, Cape Town, etc.)
- Is a Wikipedia article, historical reference, or archived content
- Cannot be dated — if no date is discernible and content appears old, reject it
- Is general political commentary with no specific connection to the monitored entity or its personnel

Return JSON: { "relevant": boolean, "reason": string (1 sentence), "confidence": number (0-1), "category": string (one of: insider_threat, reputational_risk, personnel_threat, physical_threat, cyber_threat, activism, general_security), "location": string }`
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
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  if (lower.includes('reddit.com')) return 'Reddit';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('pastebin.com')) return 'Pastebin';
  if (lower.includes('cbc.ca') || lower.includes('globeandmail.com') || lower.includes('nationalpost.com') ||
      lower.includes('thestar.com') || lower.includes('calgaryherald.com') || lower.includes('vancouversun.com') ||
      lower.includes('edmontonjournal.com') || lower.includes('reuters.com') || lower.includes('apnews.com') ||
      lower.includes('bloomberg.com') || lower.includes('financialpost.com') || lower.includes('bnnbloomberg.ca')) return 'News';
  return 'Web';
}
