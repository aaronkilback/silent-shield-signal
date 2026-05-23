import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { enqueueJob } from "../_shared/queue.ts";
import { toProbability } from "../_shared/signal-scores.ts";

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

interface OutreachSourceExtended extends OutreachSource {
  requiresGeoMatch?: boolean; // If true, item must mention NE BC location to be processed
}

// NE BC community outreach sources
// NOTE: Peace Arch News was removed — it covers Surrey/Metro Vancouver (Fraser Valley), not Peace River.
const RSS_SOURCES: OutreachSourceExtended[] = [
  // Local News - Fort St. John / Peace Region
  { name: 'Energetic City News', type: 'rss', url: 'https://www.energeticcity.ca/feed/' },
  { name: 'Alaska Highway News', type: 'rss', url: 'https://www.alaskahighwaynews.ca/rss' },
  // BC Government — covers all of BC, so geo-gate required
  { name: 'BC Gov News', type: 'rss', url: 'https://news.gov.bc.ca/feed', requiresGeoMatch: true },
];

// Google Search queries for community outreach (consolidated to reduce API calls)
const OUTREACH_SEARCH_QUERIES = [
  // Combined First Nations + community engagement (covers Treaty 8 nations + Fort St. John area)
  '("First Nations" OR "Treaty 8" OR "Blueberry River" OR "Doig River" OR "West Moberly") (consultation OR engagement OR meeting OR announcement) ("Fort St. John" OR "northeast BC" OR "Peace River")',
  // Industry-community + local government (covers LNG/pipeline + regional events)
  '(LNG OR pipeline OR "Coastal GasLink" OR "Peace River Regional District" OR "City of Fort St. John") (community OR engagement OR "open house" OR consultation) "British Columbia"',
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
  'linkedin.com', 'tumblr.com', 'volcanodiscovery.com',
  'facebook.com/groups', 'pinterest.com', 'tiktok.com',
  'amazon.com', 'ebay.com', 'reddit.com',
  // Job boards & recruitment sites
  'experiencehub.ca', 'jobs.ca', 'workbc.ca', 'jobbank.gc.ca',
  'glassdoor.com', 'ziprecruiter.com', 'careerbuilder.com',
  // PROD-K T1 (2026-05-22): job-board domains seen in prod corpus —
  // FANU07-25 Assistant Professor (3×), Administrative Assistant -
  // Corrpro Canada | BeBee, Silviculture Forester | JobLeads.com,
  // SPO/STO BC Public Service. All passed the keyword scorer because
  // job postings include First Nations / employment-equity language.
  'njoyn.com', 'bebee.com', 'jobleads.com', 'joboptionsbc.ca',
  'careers.gov.bc.ca', 'unbc.njoyn.com',
  // PROD-K T1: bid / RFP aggregators (passed as "First Nations
  // contract" matches). British Columbia Bids aggregator titled
  // "Find Contracts, Tenders & RFP Opportunities".
  'bcbid.gov.bc.ca', 'bidsandtenders.ca', 'merx.com',
  // Obituary sites
  'shortenandryan.com', 'legacy.com', 'arbormemorial.ca',
  'dignitymemorial.com', 'remembering.ca',
  // Generic health/institutional portals
  'phsa.ca', 'interiorhealth.ca',
];

// PROD-K T1 (2026-05-22): URL-path patterns that indicate job listings,
// newswire syndication, or generic listing pages — regardless of host.
// The Site C newswire flood (7× CP wire story in 8h) came in via 7
// different syndicate hosts (infonews.ca, timminstoday.com, etc.) so
// host-only blocking can't catch it; path-pattern matching can.
const BLOCKED_URL_PATH_PATTERNS: RegExp[] = [
  /\/cp-newsalert/i,             // Canadian Press wire (multi-host syndication)
  /\/national-news\//i,           // generic news aggregator path
  /xweb\.asp/i,                  // Njoyn job-board permalinks
  /[?&]tbtoken=/i,               // Njoyn rotating session token (causes URL-hash churn)
  /\/(jobs?|careers?)\//i,       // /job/, /jobs/, /career/, /careers/
  /\/job-postings?\//i,
  /\/tenders?\//i,
];

// PROD-K T1: title prefixes that mark content as job-posting / newswire
// / aggregator regardless of source. Belt-and-suspenders with the
// domain + path blocks.
const BLOCKED_TITLE_PATTERNS: RegExp[] = [
  /^CP NewsAlert/i,
  /^CP Newsalert/i,
  /^FANU\d+/i,                    // Njoyn job IDs (FANU07-25 Assistant Professor)
  /\bAssistant Professor\b/i,     // academic job postings
  /\bLicensed Practical Nurse\b/i,
  /\bAdministrative Assistant\b/i,
  /\bSilviculture Forester\b/i,
  /\bFind Contracts,? Tenders/i,  // BC Bids aggregator landing page
];

// PROD-K T1: shared block-source helper. Used by all three ingestion
// paths (RSS, Google CSE, band sites) so a job posting or wire-story
// can't sneak in via the path that doesn't apply EXCLUDED_DOMAINS.
function isBlockedSource(url: string | null | undefined, title: string | null | undefined): { blocked: boolean; reason?: string } {
  const u = (url || '').toLowerCase();
  const t = (title || '').trim();
  if (u && EXCLUDED_DOMAINS.some((d) => u.includes(d))) {
    return { blocked: true, reason: 'excluded_domain' };
  }
  if (u && BLOCKED_URL_PATH_PATTERNS.some((re) => re.test(u))) {
    return { blocked: true, reason: 'blocked_path_pattern' };
  }
  if (t && BLOCKED_TITLE_PATTERNS.some((re) => re.test(t))) {
    return { blocked: true, reason: 'blocked_title_pattern' };
  }
  return { blocked: false };
}

// PROD-K T3 (2026-05-22): URL canonicalization. The dedup hash was
// keyed on `${url}|${title}` — but URL forms vary across fetches even
// for the same article: rotating query tokens (tbtoken=, utm_*),
// session IDs, fragments, trailing slashes, and host casing all
// produce different hashes for the same content. Canonicalize to:
// lowercase host, strip query string entirely (Phase 1 takes the
// safe-but-blunt approach — no whitelist), strip fragment, strip
// trailing slash. Preserves the original URL on the stored signal
// (`raw_json.url`) for analyst attribution; only the hash input is
// canonicalized.
function canonicalizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

// PROD-K (2026-05-22): community-outreach source_id, referenced by the
// title-only dedup query. Single source of truth.
const COMMUNITY_OUTREACH_SOURCE_ID = 'b604b8c8-8a19-4ddc-a0e6-9ea422af474f';

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
          // PROD-K T1 (2026-05-22): apply shared source block-list to
          // the RSS path. Previously this path had NO domain/path/title
          // filtering, so a CP-NewsAlert syndicated story arriving via
          // an Energetic City re-publish path could land here. Belt
          // with the equivalent Google-CSE guard added below.
          const rssBlock = isBlockedSource(item.link, item.title);
          if (rssBlock.blocked) {
            console.log(`[PROD-K T1] RSS block (${rssBlock.reason}): ${(item.title || '').substring(0, 80)}`);
            continue;
          }

          const content = `${item.title} ${item.description}`.toLowerCase();

          // Geographic gate: for broad-coverage feeds (e.g. BC Gov News), require at least one
          // NE BC / operational location keyword before scoring to prevent off-geography signals.
          if ((source as OutreachSourceExtended).requiresGeoMatch) {
            const geoTerms = ['fort st. john', 'fort st john', 'dawson creek', 'hudson\'s hope',
              'chetwynd', 'tumbler ridge', 'taylor bc', 'peace river', 'northeast bc',
              'charlie lake', 'pink mountain', 'wonowon', 'montney', 'kiskatinaw',
              'blueberry river', 'doig river', 'halfway river', 'prophet river', 'west moberly',
              'saulteau', 'mcleod lake', 'tsay keh dene', 'kwadacha',
              'kitimat', 'skeena', 'coastal gaslink', 'lng canada'];
            const hasGeoMatch = geoTerms.some(t => content.includes(t));
            if (!hasGeoMatch) {
              console.log(`[GeoGate] Skipping off-geography item from ${source.name}: ${item.title?.substring(0, 60)}`);
              continue;
            }
          }

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
            // PROD-K T1 (2026-05-22): broadened from domain-only block
            // to the shared isBlockedSource() helper. Catches:
            //   - extended job-board domains (njoyn, bebee, jobleads,
            //     joboptionsbc, careers.gov.bc.ca, bcbid)
            //   - URL-path patterns for job listings / CP newswire
            //     syndication (/cp-newsalert, /national-news,
            //     xweb.asp, tbtoken=, /job/, /career/, /tenders/)
            //   - title prefixes (CP NewsAlert, FANU job IDs, common
            //     job-posting titles, "Find Contracts, Tenders")
            // Closes the path that produced the Site C newswire flood
            // (7× in 8h from 7 syndicate hosts) and Njoyn job dupes.
            const cseBlock = isBlockedSource(item.link, item.title);
            if (cseBlock.blocked) {
              console.log(`[PROD-K T1] CSE block (${cseBlock.reason}): ${(item.title || '').substring(0, 80)}`);
              continue;
            }

            // Junk-content gate. Reject literal nav/search/sitemap
            // pages BEFORE the keyword scorer sees them — operator
            // caught the feed flooding with "Search | Town of Peace
            // River" hits because those pages happen to contain the
            // keyword "Peace".
            const rawTitle = item.title || '';
            const rawSnippet = item.snippet || '';
            if (isJunkContent(rawTitle) || isJunkContent(rawSnippet)) {
              console.log(`[Junk] Skipping nav/search page: ${rawTitle.substring(0, 80)}`);
              continue;
            }

            const content = `${rawTitle} ${rawSnippet}`.toLowerCase();

            // Geographic gate. The RSS path already enforces this for
            // broad-coverage feeds; the Google Search path didn't,
            // letting matches from off-geography municipalities
            // (Toronto accountants, Nanaimo chapels, generic Alberta
            // sober-living lists) pass through. Re-use the same NE-BC
            // / operational-zone keyword set so both paths are
            // consistent.
            const geoTerms = [
              'fort st. john', 'fort st john', 'dawson creek', "hudson's hope",
              'chetwynd', 'tumbler ridge', 'taylor bc', 'peace river regional',
              'northeast bc', 'charlie lake', 'pink mountain', 'wonowon',
              'montney', 'kiskatinaw', 'blueberry river', 'doig river',
              'halfway river', 'prophet river', 'west moberly', 'saulteau',
              'mcleod lake', 'tsay keh dene', 'kwadacha',
              'kitimat', 'skeena', 'coastal gaslink', 'lng canada',
              // Note: deliberately NOT including the bare token "peace"
              // or "peace river" alone — too many false positives
              // ("Town of Peace River" search nav, "rest in peace"
              // in obituaries, etc). Use "peace river regional"
              // (district name) and the specific First Nations names
              // instead.
            ];
            if (!geoTerms.some((t) => content.includes(t))) {
              console.log(`[GeoGate] Skipping off-geography Google result: ${rawTitle.substring(0, 60)}`);
              continue;
            }

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

            // PROD-K T1 (2026-05-22): block-list check on the band-site
            // path too. Band sites mostly publish their own content but
            // sometimes re-publish CP newswire / job postings on
            // "careers" or "news" pages; the title-pattern check
            // catches those without needing per-site rules.
            const bandTitle = `${band.name}: ${snippet.substring(0, 80)}`;
            const bandBlock = isBlockedSource(band.url, bandTitle);
            if (bandBlock.blocked) {
              console.log(`[PROD-K T1] BandSite block (${bandBlock.reason}): ${bandTitle.substring(0, 80)}`);
              continue;
            }

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

    // Heartbeat
    await recordHeartbeat(supabase, 'monitor-community-outreach-hourly', 'completed', { signals_created: signalsCreated, items_scanned: itemsScanned, sources: sourcesProcessed });

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

// Junk-content patterns. A title or snippet matching any of these is
// almost certainly a search page / site nav / index — NOT outreach
// content. Operator caught this when the feed flooded with 9× "Search
// | Town of Peace River" entries May 2026; the keyword scorer was
// matching the literal word "Peace" in those nav-page titles.
const JUNK_CONTENT_PATTERNS = [
  /^search\s*[|:|–|-]/i,             // "Search | Town of X"
  /^search results/i,
  /^site\s*map\b/i,
  /^index of\b/i,
  /^untitled\b/i,
  /\bpage not found\b/i,
  /\b404\s*(error|not found)\b/i,
  /^how much does an? .* cost/i,     // "How much does an accountant cost in Toronto?"
  /\bbest .* (?:rehab|sober living|treatment) (?:homes|centers?|centres?)\b/i,
];

function isJunkContent(rawContent: string): boolean {
  // Use the original (non-lowercased) content if available so the
  // patterns can anchor on title-case starts. Tolerate either form.
  const c = rawContent.trim();
  return JUNK_CONTENT_PATTERNS.some((re) => re.test(c));
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

  // Reject site-nav / search-page / generic-Q&A junk that has no
  // operational content even if it happens to keyword-match.
  if (isJunkContent(content)) {
    return { score: 0, reasons: ['Excluded: junk/nav-page content'], outreachType: 'excluded' };
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
    // PROD-K T2 (2026-05-22): title-only dedup window (72h).
    //
    // The content_hash dedup keys on `${url}|${title}`. Because URLs
    // vary across fetches (rotating tokens, multi-syndicate hosts,
    // title-truncation variants), the same article was admitted up to
    // 7× in 8h (Site C newswire flood). An exact-title match scoped
    // to this monitor's source_id over 72h catches the syndicated-
    // newswire and Njoyn-job-rotation cases without affecting
    // legitimately-distinct articles (which never share an exact
    // title verbatim).
    //
    // Uses .maybeSingle() not .single() to avoid the silent admit
    // when 2+ historical rows already share the title.
    const normalizedTitle = (data.title || '').trim();
    if (normalizedTitle.length > 0) {
      const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const { data: existingByTitle } = await supabase
        .from('signals')
        .select('id, created_at')
        .eq('source_id', COMMUNITY_OUTREACH_SOURCE_ID)
        .eq('title', normalizedTitle)
        .gte('created_at', seventyTwoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingByTitle) {
        console.log(`[PROD-K T2] Title dedup 72h hit (existing ${existingByTitle.id}): "${normalizedTitle.substring(0, 60)}"`);
        return false;
      }
    }

    // PROD-K T3 (2026-05-22): URL-canonical hash. The original
    // `${data.url}|${data.title}` hash was defeated by:
    //   * rotating query strings (Njoyn tbtoken=)
    //   * fragment churn
    //   * trailing-slash variance
    //   * host-case variance
    //   * title-text variance (CSE truncation "..." vs full title)
    // canonicalizeUrl() strips query+fragment, lowercases host, strips
    // trailing slash. We hash on the canonical URL alone when one
    // exists — title is intentionally excluded from the hash now
    // because T2 above already provides title-equivalence dedup, and
    // url-with-title was producing more collisions than it prevented.
    // Falls back to title-only hash for items without a URL.
    const canonicalUrl = canonicalizeUrl(data.url);
    const contentToHash = canonicalUrl
      ? `url:${canonicalUrl}`
      : `title:${normalizedTitle}`;
    const encoder = new TextEncoder();
    const hashData = encoder.encode(contentToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Check for existing signal (URL-canonical hash dedup).
    // PROD-K (2026-05-22): switched .single() → .maybeSingle(). The
    // old .single() returned `data=null` AND an error when 2+ rows
    // shared the same hash (legacy race), which the destructured
    // `existing` check then treated as falsy — silently re-admitting
    // duplicates. maybeSingle() is tolerant of 0-or-1 row, which is
    // the actual contract here.
    const { data: existing } = await supabase
      .from('signals')
      .select('id')
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (existing) {
      console.log(`[PROD-K T3] URL-canonical hash dedup hit (existing ${existing.id}): ${(data.url || '').substring(0, 80)}`);
      return false;
    }

    // Check if this content was previously rejected/deleted
    const { data: rejectedHash } = await supabase
      .from('rejected_content_hashes')
      .select('id')
      .eq('content_hash', contentHash)
      .limit(1)
      .maybeSingle();

    if (rejectedHash) {
      console.log(`Skipping previously rejected signal: ${data.title.substring(0, 50)}`);
      return false;
    }

    const normalizedText = `[Community Outreach] ${data.title}\n\n${data.description}`;

    // Direct insert preserves the custom geo+keyword scoring + dedup applied
    // earlier in this function. After insert, fire-and-forget ai-decision-engine
    // so the signal still gets composite_confidence + agent_review enrichment.
    // Watchdog 2026-04-30 surfaced these as missing AI context.
    // signals.confidence is on the 0-1 probability scale. The
    // keyword scorer outputs 0-100. _shared/signal-scores.ts is the
    // single source of truth for the conversion — every writer of
    // this column should use toProbability() instead of inlining a
    // /100 (which is what failed to ship here in the first place,
    // causing the "junk pages render as 65%, real events render
    // as 1%" inversion).
    const confidence01 = toProbability(data.relevanceScore) ?? 0;

    const { data: insertedSignal, error } = await supabase
      .from('signals')
      .insert({
        client_id: data.clientId,
        // 2026-05-08: source_id populated for watchdog source-coverage
        // tracking. Maps to public.sources WHERE name='Community Outreach Monitor'.
        source_id: COMMUNITY_OUTREACH_SOURCE_ID,
        category: 'community_outreach',
        severity: 'low',
        status: 'new',
        title: data.title,
        normalized_text: normalizedText,
        content_hash: contentHash,
        event_date: data.publishedDate ? new Date(data.publishedDate).toISOString() : null,
        confidence: confidence01,
        raw_json: {
          source: data.source,
          outreach_type: data.outreachType,
          relevance_score: data.relevanceScore,    // 0-100 (keep for analytics)
          relevance_reasons: data.relevanceReasons,
          url: data.url,
          published_date: data.publishedDate,
        },
        received_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating outreach signal:', error);
      return false;
    }

    console.log(`✓ Outreach signal [${data.outreachType}]: ${data.title.substring(0, 60)}`);
    if (insertedSignal?.id) {
      // Durable queue (was fire-and-forget invoke).
      await enqueueJob(supabase, {
        type: 'ai-decision-engine',
        payload: { signal_id: insertedSignal.id, force_ai: false },
        idempotencyKey: `ai-decision-engine:${insertedSignal.id}`,
      }).catch((err: any) => console.warn('[CommunityOutreach] enqueueJob failed:', err?.message || err));
    }
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