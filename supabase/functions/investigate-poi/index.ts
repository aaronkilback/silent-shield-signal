/**
 * investigate-poi
 *
 * Comprehensive OSINT investigation for a Person of Interest (POI).
 *
 * Steps:
 *  1. Load entity (name, aliases, type, metadata)
 *  2. Build 15-20 targeted search queries
 *  3. Fan-out via Google Custom Search API (with 1200ms inter-query delay)
 *  4. Check HaveIBeenPwned for email addresses if HIBP_API_KEY is set
 *  5. Store results as entity_content rows (deduped by URL)
 *  6. Invoke generate-poi-report
 *  7. Return investigation summary
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { extractOGImage } from "../_shared/og-image.ts";

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const HIBP_ENDPOINT = 'https://haveibeenpwned.com/api/v3/breachedaccount';
const INTER_EMAIL_DELAY_MS = 1500;
const QUERY_TIMEOUT_MS = 12000;     // per-query fetch timeout
const PAGE_FETCH_TIMEOUT_MS = 20000; // page content fetch timeout
const MAX_QUERIES = 30;             // keep well under Supabase's 150s wall-clock limit
const MAX_PARALLEL = 5;             // concurrent Google CSE requests
const MAX_PAGE_FETCHES = 30;        // max pages to deep-fetch for full content

// High-value domains worth fetching full content from
const HIGH_VALUE_DOMAINS = [
  'whitepages.com', 'spokeo.com', 'fastpeoplesearch.com', 'radaris.com',
  'intelius.com', 'zabasearch.com', 'peoplefinder.com', 'peekyou.com',
  'beenverified.com', 'instantcheckmate.com', 'truthfinder.com',
  'courtlistener.com', 'judyrecords.com', 'unicourt.com',
  'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'wikipedia.org', 'imdb.com', 'wikidata.org',
  'cbc.ca', 'globalnews.ca', 'nationalpost.com', 'theglobeandmail.com',
  'cp24.com', 'ctv.ca', 'calgaryherald.com', 'edmontonjournal.com',
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source_type: string;
}

/**
 * Fetch actual page content from a URL and extract plain text.
 * Returns empty string on failure.
 */
async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return '';
    const html = await response.text();
    // Strip HTML tags and collapse whitespace to extract readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '  ')
      .trim();
    return text.substring(0, 4000);
  } catch {
    return '';
  }
}

/**
 * Execute a single Google Custom Search query.
 * Returns up to 10 results or [] on failure.
 */
async function googleSearch(query: string, apiKey: string, cseId: string): Promise<SearchResult[]> {
  try {
    const url = `${GOOGLE_CSE_ENDPOINT}?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&q=${encodeURIComponent(query)}&num=10`;
    const response = await fetch(url, { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
    if (!response.ok) {
      console.log(`[CSE] HTTP ${response.status} for query: ${query.substring(0, 60)}`);
      return [];
    }
    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      source_type: 'web_search',
    }));
  } catch (err) {
    console.log(`[CSE] Search failed: ${err}`);
    return [];
  }
}

/**
 * Build investigation queries for an entity.
 */
function buildQueries(entity: any): string[] {
  const name = entity.name as string;
  const aliases: string[] = Array.isArray(entity.aliases)
    ? entity.aliases
    : (entity.aliases ? [entity.aliases] : []);
  const attributes = entity.attributes || {};
  const emails: string[] = attributes.emails || [];
  const handles: string[] = attributes.handles || attributes.usernames || [];
  const organization: string = attributes.organization || attributes.company || '';
  const location: string = attributes.location || '';
  const description: string = entity.description || '';
  const role: string = attributes.role || attributes.occupation || attributes.title || '';

  // Detect public figures from description/role keywords
  const publicFigureKeywords = /model|actress|actor|activist|speaker|politician|celebrity|musician|singer|athlete|journalist|author|executive|director|president|ceo|indigenous|first nations|métis|inuit/i;
  const isPublicFigure = publicFigureKeywords.test(description) || publicFigureKeywords.test(role);

  const queries: string[] = [];

  // ── Tier 1: Core identity ──────────────────────────────────────────────────
  queries.push(`"${name}"`);
  queries.push(`"${name}" site:linkedin.com OR site:facebook.com OR site:twitter.com OR site:instagram.com OR site:tiktok.com`);
  queries.push(`"${name}" news OR interview OR profile OR biography`);

  // ── Tier 1b: Public figure / knowledge sources ─────────────────────────────
  if (isPublicFigure) {
    queries.push(`"${name}" site:wikipedia.org OR site:wikidata.org OR site:imdb.com`);
    queries.push(`"${name}" site:cbc.ca OR site:globalnews.ca OR site:nationalpost.com OR site:theglobeandmail.com`);
    queries.push(`"${name}" site:cp24.com OR site:ctv.ca OR site:calgaryherald.com OR site:edmontonjournal.com`);
    if (role) {
      queries.push(`"${name}" ${role}`);
    }
    // Pull role keywords out of description for targeted queries
    const descWords = (description + ' ' + role).match(publicFigureKeywords);
    if (descWords) {
      queries.push(`"${name}" ${descWords[0]} career OR work OR achievement OR award`);
    }
  }

  // ── Tier 2: Address & location intelligence ────────────────────────────────
  queries.push(`"${name}" address OR "lives at" OR "located at" OR residence OR "home address"`);
  queries.push(`"${name}" site:whitepages.com OR site:spokeo.com OR site:fastpeoplesearch.com OR site:radaris.com OR site:intelius.com`);
  queries.push(`"${name}" site:zabasearch.com OR site:peoplefinder.com OR site:peekyou.com OR site:pipl.com`);
  if (location) {
    queries.push(`"${name}" "${location}" address OR street OR apartment OR neighborhood`);
    queries.push(`"${name}" "${location}"`);
  }

  // ── Tier 3: Criminal, legal & court records ────────────────────────────────
  queries.push(`"${name}" court OR charged OR convicted OR arrested OR indicted OR warrant`);
  queries.push(`"${name}" mugshot OR "arrest record" OR "criminal record" OR "police report"`);
  queries.push(`"${name}" site:courtlistener.com OR site:pacer.gov OR site:judyrecords.com OR site:unicourt.com`);
  queries.push(`"${name}" lawsuit OR plaintiff OR defendant OR "civil suit"`);

  // ── Tier 4: Financial & property records ──────────────────────────────────
  queries.push(`"${name}" property OR "property owner" OR deed OR mortgage OR "real estate"`);
  queries.push(`"${name}" site:linkedin.com employer OR company OR "works at" OR "employed by"`);

  // ── Tier 5: Social & platform depth ───────────────────────────────────────
  queries.push(`"${name}" site:reddit.com OR site:quora.com OR site:youtube.com`);
  queries.push(`"${name}" site:t.me OR site:telegram.me OR site:gab.com OR site:parler.com`);
  queries.push(`"${name}" site:pastebin.com OR site:paste.ee OR site:hastebin.com`);
  queries.push(`"${name}" filetype:pdf OR filetype:doc`);

  // ── Tier 6: Organization-scoped ────────────────────────────────────────────
  if (organization) {
    queries.push(`"${name}" "${organization}"`);
    queries.push(`"${name}" "${organization}" address OR contact OR phone OR email`);
  }

  // ── Tier 7: Aliases ────────────────────────────────────────────────────────
  for (const alias of aliases.slice(0, 2)) {
    queries.push(`"${alias}" address OR location OR arrest OR threat`);
    queries.push(`"${alias}" site:linkedin.com OR site:twitter.com OR site:facebook.com`);
  }

  // ── Tier 8: Handles / usernames ────────────────────────────────────────────
  for (const handle of handles.slice(0, 2)) {
    queries.push(`"${handle}" site:twitter.com OR site:instagram.com OR site:reddit.com OR site:telegram.me`);
  }

  // ── Tier 9: Email addresses ────────────────────────────────────────────────
  for (const email of emails.slice(0, 2)) {
    queries.push(`"${email}"`);
  }

  // ── Tier 10: Associates & network ─────────────────────────────────────────
  queries.push(`"${name}" associate OR colleague OR "known associate" OR accomplice OR confederate`);
  queries.push(`"${name}" brother OR sister OR wife OR husband OR spouse OR partner OR son OR daughter OR parent`);
  if (organization) {
    queries.push(`"${name}" "${organization}" colleague OR coworker OR associate OR "works with"`);
  }

  // ── Tier 11: Contact information ──────────────────────────────────────────
  queries.push(`"${name}" "phone number" OR "cell phone" OR "mobile number" OR "contact number"`);
  queries.push(`"${name}" email OR "@gmail.com" OR "@hotmail.com" OR "@yahoo.com" OR "@outlook.com" OR "@proton.me"`);
  queries.push(`"${name}" contact OR "reach" OR "get in touch" OR "direct message"`);

  // Deduplicate
  return [...new Set(queries)];
}

/**
 * Check HaveIBeenPwned for a single email address.
 */
async function checkHibp(email: string, apiKey: string): Promise<any[]> {
  try {
    const response = await fetch(`${HIBP_ENDPOINT}/${encodeURIComponent(email)}?truncateResponse=false`, {
      headers: {
        'hibp-api-key': apiKey,
        'user-agent': 'Fortress-Silent-Shield-Signal/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return []; // no breaches
    if (!response.ok) {
      console.log(`[HIBP] HTTP ${response.status} for ${email}`);
      return [];
    }
    return await response.json();
  } catch (err) {
    console.log(`[HIBP] Check failed for ${email}: ${err}`);
    return [];
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const { entity_id } = body;

    if (!entity_id) return successResponse({ error: "entity_id is required" });

    // ── Load entity ──────────────────────────────────────────────────────────
    const { data: entity, error: entityErr } = await supabase
      .from('entities')
      .select('id, name, type, risk_level, aliases, attributes, description')
      .eq('id', entity_id)
      .single();

    if (entityErr || !entity) {
      return successResponse({ error: `Entity not found: ${entityErr?.message ?? 'no rows'}` });
    }

    // ── Create investigation record (status=running) ──────────────────────────
    const { data: investigation, error: invErr } = await supabase
      .from('poi_investigations')
      .insert({
        entity_id,
        status: 'running',
        queries_run: [],
        sources_searched: 0,
        results_found: 0,
        hibp_checked: false,
      })
      .select('id')
      .single();

    if (invErr || !investigation) {
      console.log(`[investigate-poi] Failed to create investigation row: ${invErr?.message}`);
      return successResponse({ error: `Failed to create investigation: ${invErr?.message}` });
    }

    const investigationId = investigation.id;

    // ── Check for required API keys ──────────────────────────────────────────
    // Support both naming conventions across edge functions
    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY') || Deno.env.get('GOOGLE_CSE_API_KEY') || '';
    const googleCseId  = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID') || Deno.env.get('GOOGLE_CSE_ID') || '';
    const hibpApiKey   = Deno.env.get('HIBP_API_KEY') || '';

    const queries = buildQueries(entity);
    const allResults: SearchResult[] = [];
    const queriesRun: string[] = [];
    let sourcesSearched = 0;

    // ── Google Custom Search fan-out (parallel batches) ──────────────────────
    if (googleApiKey && googleCseId) {
      const cappedQueries = queries.slice(0, MAX_QUERIES);
      // Process in parallel chunks of MAX_PARALLEL to avoid rate limits
      for (let i = 0; i < cappedQueries.length; i += MAX_PARALLEL) {
        const batch = cappedQueries.slice(i, i + MAX_PARALLEL);
        const batchResults = await Promise.all(
          batch.map(q => googleSearch(q, googleApiKey, googleCseId))
        );
        for (let j = 0; j < batch.length; j++) {
          queriesRun.push(batch[j]);
          sourcesSearched += batchResults[j].length;
          allResults.push(...batchResults[j]);
        }
        // Small delay between batches to respect CSE rate limits
        if (i + MAX_PARALLEL < cappedQueries.length) await sleep(500);
      }
    } else {
      console.log('[investigate-poi] No Google CSE credentials — skipping web search');
      queriesRun.push(...queries.slice(0, MAX_QUERIES));
    }

    // ── Dedup and filter generic/homepage results ────────────────────────────
    const seenUrls = new Set<string>();

    // Returns true if the URL points to a specific page (article, post, profile)
    // rather than a site root or generic directory listing.
    const isSpecificPage = (url: string): boolean => {
      try {
        const { pathname, search } = new URL(url);
        // Allow root URLs only for known people-search / court domains
        const alwaysAllow = HIGH_VALUE_DOMAINS.slice(0, 11); // people-search + court domains
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (alwaysAllow.some(d => host.includes(d))) return true;
        // Reject bare roots and near-roots (e.g. /en/, /en/about)
        const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
        if (parts.length === 0) return false;
        if (parts.length === 1 && parts[0].length < 4) return false;
        return true;
      } catch { return true; }
    };

    const uniqueResults = allResults.filter(r => {
      if (!r.url || seenUrls.has(r.url)) return false;
      if (!isSpecificPage(r.url)) {
        console.log(`[investigate-poi] Skip generic URL: ${r.url}`);
        return false;
      }
      seenUrls.add(r.url);
      return true;
    });

    // ── Deep-fetch high-value pages for full content ──────────────────────────
    const hostname = (url: string) => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    };

    // Prioritise: high-value domains first, then all others
    const isHighValue = (url: string) => HIGH_VALUE_DOMAINS.some(d => url.includes(d));
    const sortedForFetch = [...uniqueResults].sort((a, b) =>
      (isHighValue(b.url) ? 1 : 0) - (isHighValue(a.url) ? 1 : 0)
    );
    const toFetch = sortedForFetch.slice(0, MAX_PAGE_FETCHES);

    // Fetch in batches of 3 to avoid hammering servers
    const fetchedContent: Map<string, string> = new Map();
    for (let i = 0; i < toFetch.length; i += 3) {
      const batch = toFetch.slice(i, i + 3);
      const contents = await Promise.all(batch.map(r => fetchPageContent(r.url)));
      batch.forEach((r, j) => {
        if (contents[j]) fetchedContent.set(r.url, contents[j]);
      });
      if (i + 3 < toFetch.length) await sleep(300);
    }

    // ── Store results as entity_content ──────────────────────────────────────
    // Threat/activist keywords — results matching these get elevated relevance
    // and will also create a signal so the finding surfaces in the signals feed.
    const THREAT_KEYWORDS = /activist|protest|threat|harass|dox|doxx|lawsuit|wpath|campaign|opposition|targeted|puberty.blocker|gender.clinic|trans.youth|anti.gender/i;

    let resultsStored = 0;
    const signalCandidates: Array<{ url: string; title: string; snippet: string; imageUrl: string | null }> = [];

    if (uniqueResults.length > 0) {
      // Extract OG images for high-value results (cap at 20 to stay within time budget)
      const imageMap = new Map<string, string | null>();
      const forImageExtract = uniqueResults.filter(r => isHighValue(r.url)).slice(0, 20);
      await Promise.allSettled(
        forImageExtract.map(async r => {
          const img = await extractOGImage(r.url).catch(() => null);
          imageMap.set(r.url, img);
        })
      );

      const contentRows = uniqueResults.map(r => {
        const imageUrl = imageMap.get(r.url) || null;
        const combinedText = `${r.title} ${r.snippet}`;
        const isThreat = THREAT_KEYWORDS.test(combinedText);
        if (isThreat) signalCandidates.push({ url: r.url, title: r.title, snippet: r.snippet, imageUrl });
        return {
          entity_id,
          url: r.url,
          title: r.title.substring(0, 500),
          excerpt: r.snippet.substring(0, 500),
          content_text: (fetchedContent.get(r.url) || r.snippet).substring(0, 4000),
          content_type: 'web_search',
          source: hostname(r.url),
          relevance_score: isThreat ? 90 : (isHighValue(r.url) ? 85 : 55),
          metadata: { image_url: imageUrl, is_threat_relevant: isThreat },
        };
      });

      // Upsert in batches of 50 (dedup by entity_id + url)
      for (let i = 0; i < contentRows.length; i += 50) {
        const batch = contentRows.slice(i, i + 50);
        const { error: upsertErr, count } = await supabase
          .from('entity_content')
          .upsert(batch, { onConflict: 'entity_id,url', ignoreDuplicates: true })
          .select('id', { count: 'exact', head: true });

        if (upsertErr) {
          console.warn(`[investigate-poi] Upsert batch error: ${upsertErr.message}`);
        } else {
          resultsStored += count || batch.length;
        }
      }
    }

    // ── Create signals for threat/activist findings ───────────────────────────
    // These go through ingest-signal so they appear in the signals feed and
    // are available to AEGIS — not just buried in entity_content.
    for (const candidate of signalCandidates.slice(0, 10)) {
      try {
        await supabase.functions.invoke('ingest-signal', {
          body: {
            text: `${candidate.title}\n\n${candidate.snippet}\n\nSource: ${candidate.url}`,
            source_url: candidate.url,
            source_name: hostname(candidate.url),
            client_id: entity.client_id || null,
            image_url: candidate.imageUrl || null,
            metadata: {
              entity_id,
              entity_name: entity.name,
              signal_origin: 'investigate-poi',
              is_threat_relevant: true,
            },
          },
        });
        console.log(`[investigate-poi] Signal created for threat finding: ${candidate.title.substring(0, 60)}`);
      } catch (sigErr) {
        console.warn(`[investigate-poi] Signal creation failed for ${candidate.url}:`, sigErr);
      }
    }

    // ── HIBP checks ──────────────────────────────────────────────────────────
    const attributes = entity.attributes || {};
    // Support both attributes.emails (legacy) and attributes.contact_info.email (current)
    const contactInfoEmails: string[] = Array.isArray(attributes.contact_info?.email)
      ? attributes.contact_info.email
      : (typeof attributes.contact_info?.email === 'string' ? [attributes.contact_info.email] : []);
    const emails: string[] = [...new Set([...(attributes.emails || []), ...contactInfoEmails])];
    let hibpChecked = false;
    let allBreaches: any[] = [];

    if (hibpApiKey && emails.length > 0) {
      hibpChecked = true;
      for (let i = 0; i < emails.length; i++) {
        const breaches = await checkHibp(emails[i], hibpApiKey);
        allBreaches.push(...breaches);
        if (i < emails.length - 1) await sleep(INTER_EMAIL_DELAY_MS);
      }
    }

    // ── Mark investigation complete ───────────────────────────────────────────
    await supabase
      .from('poi_investigations')
      .update({
        queries_run: queriesRun,
        sources_searched: sourcesSearched,
        results_found: resultsStored,
        hibp_checked: hibpChecked,
        hibp_breaches: allBreaches.length > 0 ? allBreaches : null,
        status: 'completed',
      })
      .eq('id', investigationId);

    return successResponse({
      investigation_id: investigationId,
      entity_id,
      entity_name: entity.name,
      queries_run: queriesRun.length,
      sources_searched: sourcesSearched,
      results_found: resultsStored,
      hibp_checked: hibpChecked,
      hibp_breaches_count: allBreaches.length,
      summary: `Investigation complete for ${entity.name}. Found ${resultsStored} unique sources.${hibpChecked ? ` HIBP: ${allBreaches.length} breach(es).` : ''} Use "Analyze" to generate the AI report.`,
    });

  } catch (error) {
    console.error('[investigate-poi] Fatal error:', error);

    // Attempt to mark investigation as failed
    try {
      const supabase = createServiceClient();
      const body = await req.clone().json().catch(() => ({}));
      if (body.entity_id) {
        // best-effort: find the running investigation and mark failed
        const { data: inv } = await supabase
          .from('poi_investigations')
          .select('id')
          .eq('entity_id', body.entity_id)
          .eq('status', 'running')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (inv) {
          await supabase
            .from('poi_investigations')
            .update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Unknown error' })
            .eq('id', inv.id);
        }
      }
    } catch (_) { /* best-effort */ }

    return successResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
