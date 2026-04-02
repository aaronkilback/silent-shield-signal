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

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const HIBP_ENDPOINT = 'https://haveibeenpwned.com/api/v3/breachedaccount';
const INTER_EMAIL_DELAY_MS = 1500;
const QUERY_TIMEOUT_MS = 5000;      // per-query fetch timeout
const PAGE_FETCH_TIMEOUT_MS = 8000; // page content fetch timeout
const MAX_QUERIES = 20;             // keep well under Supabase's 150s wall-clock limit
const MAX_PARALLEL = 3;             // concurrent Google CSE requests
const MAX_PAGE_FETCHES = 15;        // max pages to deep-fetch for full content

// High-value domains worth fetching full content from
const HIGH_VALUE_DOMAINS = [
  'whitepages.com', 'spokeo.com', 'fastpeoplesearch.com', 'radaris.com',
  'intelius.com', 'zabasearch.com', 'peoplefinder.com', 'peekyou.com',
  'beenverified.com', 'instantcheckmate.com', 'truthfinder.com',
  'courtlistener.com', 'judyrecords.com', 'unicourt.com',
  'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
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
  const organization: string = attributes.organization || '';
  const location: string = attributes.location || '';

  const queries: string[] = [];

  // ── Tier 1: Core identity ──────────────────────────────────────────────────
  queries.push(`"${name}"`);
  queries.push(`"${name}" site:linkedin.com OR site:facebook.com OR site:twitter.com OR site:instagram.com OR site:tiktok.com`);
  queries.push(`"${name}" news OR interview OR profile OR biography`);

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
    const googleApiKey = Deno.env.get('GOOGLE_CSE_API_KEY') || '';
    const googleCseId  = Deno.env.get('GOOGLE_CSE_ID') || '';
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

    // ── Dedup results by URL ─────────────────────────────────────────────────
    const seenUrls = new Set<string>();
    const uniqueResults = allResults.filter(r => {
      if (!r.url || seenUrls.has(r.url)) return false;
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
    let resultsStored = 0;
    if (uniqueResults.length > 0) {
      const contentRows = uniqueResults.map(r => ({
        entity_id,
        url: r.url,
        title: r.title.substring(0, 500),
        excerpt: r.snippet.substring(0, 500),
        // Use fetched full-page content if available, else fall back to snippet
        content_text: (fetchedContent.get(r.url) || r.snippet).substring(0, 4000),
        content_type: 'web_search',
        source: hostname(r.url),
        relevance_score: isHighValue(r.url) ? 75 : 50,
      }));

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

    // ── HIBP checks ──────────────────────────────────────────────────────────
    const attributes = entity.attributes || {};
    const emails: string[] = attributes.emails || [];
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
