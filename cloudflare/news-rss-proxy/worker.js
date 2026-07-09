/**
 * news-rss-proxy — Cloudflare Worker fetch-proxy for Google News RSS (#81).
 *
 * WHY: Google returns 503/429 to Supabase datacenter egress IPs on news.google.com/rss, which
 * paused 14 client-relevant Google-News query feeds on 2026-04-12. Cloudflare's egress IP pool is
 * large/diverse; this Worker fetches news.google.com from CF and returns the RSS, so monitor-rss-
 * sources (running on Supabase) can reach it again by pointing the feed URL at this Worker.
 *
 * SECURITY: host-locked to news.google.com (NOT an open proxy — no SSRF), plus an optional shared
 * secret. Read-only GET passthrough.
 *
 * REPOINTING: a feed URL of
 *     https://news.google.com/rss/search?q=Coastal+GasLink&hl=en-CA&gl=CA&ceid=CA:en
 * becomes (just swap the host + add the secret):
 *     https://<worker-host>/rss/search?q=Coastal+GasLink&hl=en-CA&gl=CA&ceid=CA:en&s=<PROXY_SECRET>
 * The Worker rebuilds the upstream news.google.com URL from the path + query (minus `s`).
 *
 * DEPLOY (operator — I have no CF auth):
 *   1. `wrangler deploy` this file (or paste into a new Worker in the CF dashboard).
 *   2. Set a secret: `wrangler secret put PROXY_SECRET` (any long random string). Optional but
 *      recommended so others can't spend your CF quota.
 *   3. Note the Worker URL (e.g. https://news-rss-proxy.<acct>.workers.dev).
 *
 * ONE-FEED TEST (before repointing all 14): repoint ONE paused feed's sources.config.url to the
 * Worker URL, set that source status='active', and over ~24h watch:
 *   SELECT signal_origin, count(*) FROM public.signals
 *   WHERE signal_origin='monitor-rss-sources' AND created_at > now()-interval '1 day'
 *     AND source_id IN (SELECT id FROM sources WHERE config->>'url' LIKE '%workers.dev%') GROUP BY 1;
 * If it yields (Google served CF) → repoint + unpause the other 13. If still blocked (Worker
 * returns 503 from upstream) → fall back to option A (paid scraper proxy).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Optional shared-secret gate (skip if PROXY_SECRET unset).
    if (env.PROXY_SECRET) {
      if (url.searchParams.get('s') !== env.PROXY_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
    }

    // Rebuild the upstream news.google.com URL from path + query (drop our own `s` param).
    const upstreamParams = new URLSearchParams(url.search);
    upstreamParams.delete('s');
    const upstreamUrl = `https://news.google.com${url.pathname}${upstreamParams.toString() ? '?' + upstreamParams.toString() : ''}`;

    // Host lock is implicit (we only ever build news.google.com URLs) — not an open proxy.
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-CA,en;q=0.9',
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
    } catch (e) {
      return new Response(`upstream fetch error: ${e}`, { status: 502 });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/xml; charset=utf-8',
        'X-Proxy-Upstream-Status': String(upstream.status),
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};
