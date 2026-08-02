# WO-SSRF-SHARED-GUARD-01 — one shared SSRF guard, applied at every caller-supplied-URL fetch

**Logged:** 2026-08-02. **Status:** SCOPE — do not build yet. **Priority:** HIGH. Origin: C2 of the WRAITH ingest-signal review (authenticated SSRF, confirmed by hand). **Scope it as a shared helper, not a point fix** — the same class recurs across many fetch sites and there is **no shared guard today**.

## The gap
`ingest-signal:653` does `fetch(url)` on a **caller-supplied** body field (`url: z.string().url()`), with **no scheme allowlist, no private-IP block, no metadata-range block, no redirect re-validation**. `zod.url()` only checks well-formedness — `http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1/`, `http://10.x/` all pass. It is behind the F-026 auth gate (so *authenticated* SSRF, not anonymous), but still real. Grep confirms **no `_shared` SSRF-guard helper exists**. The 2026-07-31 fetch-url-content SSRF containment did not cover this — **partial containment confirmed**, and it will recur when fetch-url-content is restored.

## Design — `_shared/safe-fetch.ts` (or `ssrf-guard.ts`)
`assertPublicUrl(rawUrl)` + a `safeFetch(rawUrl, opts)` wrapper:
1. **Scheme allowlist:** `http`/`https` only (reject `file:`, `gopher:`, `ftp:`, `data:`, etc.).
2. **Host/IP block:** resolve DNS, then reject if the resolved IP is in any private/reserved range — RFC1918 (`10/8`, `172.16/12`, `192.168/16`), loopback (`127/8`, `::1`), link-local + **cloud metadata** (`169.254/16`, incl. `169.254.169.254`; IMDSv2 hop), CGNAT (`100.64/10`), ULA (`fc00::/7`), `0.0.0.0/8`, multicast. Block by *resolved IP*, not just hostname string (defeats `http://metadata.attacker.com` → 169.254).
3. **DNS-rebinding defense:** resolve once, pin the connection to the validated IP (or re-validate the IP actually connected to).
4. **Redirect re-validation per hop:** `redirect: 'manual'`; on each 3xx, re-run `assertPublicUrl` on the `Location` before following (an allowed URL must not 302 to `169.254.169.254`). Cap hops.
5. Keep the existing timeout + a response-size cap.

## Apply at every caller-/source-supplied-URL fetch
**Confirmed caller/signal/source-supplied (SSRF-relevant — must use the guard):**
- `ingest-signal:653` — body `url` (C2, confirmed).
- `_shared/og-image.ts:8` — OG image from an article/signal URL (the fetch-url-content class).
- `_shared/media-capture.ts:134` — media from a signal source URL.
- `backfill-signal-media:179` + `:297` — image/media URLs from signals.
- `ingest-expert-media:639` — media URL.
- `process-stored-document:24` — document URL.
- `osint-web-search:33` — search-result URL followed server-side.
- `test-osint-source-connectivity:49` — operator-supplied source URL under test (authenticated, but still SSRF).

**Verify per-site then guard (URL source needs a read to confirm caller-supplied):**
- `ingest-intelligence:29`, `incident-watch:249`, `voice-tool-executor-v2:305`, `dashboard-ai-assistant:89`.

**Semi-trusted but attacker-influenceable (source rows can be added via source-discovery — guard too):**
- `monitor-rss-sources:187` (`feedUrl` from `sources`), `monitor-weather:125`, and other monitors that fetch a `sources`-table URL. (WO-SOURCE-DISCOVERY-RELEVANCE-01 shows the source table is not tightly gated.)

**Lower risk / likely fine (host-constrained or fixed govt/API endpoints) — audit but not primary:**
- `job-worker:109` (host-pinned to `${SUPABASE_URL}/functions/v1/...`), the weather/wildfire/arcgis/open-meteo/fwi govt-API fetches, `system-ops:464` (HEAD uptime check).

## Sequence
Build the shared guard → apply to the "confirmed" set first (starting `ingest-signal:653`) → the "verify" set → the source-table set. Wire it into fetch-url-content **before** that capability is restored. Track coverage explicitly (which fetch sites are guarded vs not) — an un-guarded caller-URL fetch is a finding.
