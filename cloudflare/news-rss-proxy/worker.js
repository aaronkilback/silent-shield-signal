/**
 * news-rss-proxy — RETIRED 2026-07-13 (see DEPLOYMENT.md teardown record).
 *
 * STATUS: worker deleted from CF account 2026-07-13T21:12 UTC via
 *   `wrangler delete --name news-rss-proxy`. Route + secret gone. File preserved as inventory
 *   (Twitter-monitor pattern) for future audit — do NOT redeploy without a new experiment.
 *
 * WHY RETIRED: 48h A/B experiment (2026-07-11T20:14 → 2026-07-13T20:38 UTC, 194 cron cycles) with
 *   1 source on the proxy path and 5 on direct URLs, per the operator's comparative-experiment
 *   ruling that replaced the earlier one-feed test:
 *     - Proxy success rate:   1/194 ≈ 0.5%
 *     - Direct success rate:  ~100% (all 5 direct sources' latest cron cycles succeeded)
 *   Decision rule from `DEPLOYMENT.md` triggered: "Proxy equal or worse → tear down."
 *   Google's block on news.google.com/rss is currently affecting CF Worker YVR egress *more* than
 *   Supabase edge-function IPs, not less — the proxy path was the actively-blocked path, opposite
 *   of the original hypothesis.
 *
 * PAID SCRAPER FALLBACK — DEPRIORITIZED. The original file header (preserved below for reference)
 *   anticipated a paid scraper fallback. Post-teardown ruling: transport is NOT the bottleneck.
 *   All 6 sources produced 0 signals over 48h even with 100% direct-path fetch success. The
 *   pipeline downstream of successful fetches (dedup / relevance filter / signal creation) is
 *   where items die. Fix the pipeline before spending on a paid-scraper transport layer.
 *
 * ORIGINAL HEADER (preserved as inventory) — was the Cloudflare Worker fetch-proxy for Google
 * News RSS (#81). Rationale, security, repointing, and comparative-experiment scaffolding all
 * followed here. Retained in git history at any commit before this one (last live version:
 * `0ca2e5a3-0416-4fef-ad6f-ac145893b30f`, deployed 2026-07-11T20:39 UTC).
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
