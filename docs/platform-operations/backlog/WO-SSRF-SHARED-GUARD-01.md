# WO-SSRF-SHARED-GUARD-01 — one shared SSRF guard, applied at every caller-supplied-URL fetch

**Logged:** 2026-08-02. **Status: CLOSED 2026-08-11** — shared guard built + applied at every caller/source-supplied fetch (Waves 1–4); full coverage sweep clean. **Priority:** HIGH. Origin: C2 of the WRAITH ingest-signal review (authenticated SSRF, confirmed by hand). **Scope it as a shared helper, not a point fix** — the same class recurs across many fetch sites and there is **no shared guard today**.

## The gap
`ingest-signal:653` does `fetch(url)` on a **caller-supplied** body field (`url: z.string().url()`), with **no scheme allowlist, no private-IP block, no metadata-range block, no redirect re-validation**. `zod.url()` only checks well-formedness — `http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1/`, `http://10.x/` all pass. It is behind the F-026 auth gate (so *authenticated* SSRF, not anonymous), but still real. Grep confirms **no `_shared` SSRF-guard helper exists**. The 2026-07-31 fetch-url-content SSRF containment did not cover this — **partial containment confirmed**, and it will recur when fetch-url-content is restored.

## STATUS 2026-08-02 — helper BUILT + negative-tested, NOT applied anywhere yet
`_shared/safe-fetch.ts` is written and proven against a temp harness (since removed). Negative tests (all BLOCKED) + control (allowed):
- `http://169.254.169.254/` → `private_ip` · `http://10.0.0.1/` → `private_ip`
- `http://10.0.0.1.nip.io/` (DNS-rebind) → `resolves_to_private (… -> 10.0.0.1)` (confirms `Deno.resolveDns` works in the edge runtime, so it won't fail-closed on legit hostnames)
- `https://httpbin.org/redirect-to?url=http://169.254.169.254/` (public→private redirect) → `private_ip` on the redirect hop
- control `https://example.com/` → allowed.
**Not adopted at any call site yet** — adoption is the next step, per the sequence below.

### monitor-rss-sources SSRF chain (task-2 confirmation)
Chain: `autonomous-source-discovery` (AI-suggested URL, inserted `status='active'` with **no relevance gate** until 2026-08-01's propose-path change) → `sources.config.url` → `monitor-rss-sources:122` (`select … where status='active'`) → `:172` (`feedUrl = config.feed_url||config.url`) → `:187` (`fetch(feedUrl)` **unguarded**). So yes — **any URL in an active rss/url_feed source is fetched server-side with no scheme/IP/metadata guard.**
- **Does the propose-path change close it? Only partially.** `status='proposed'` stops *new* discovered sources from being active-and-fetched until promoted, shrinking the write vector. But it does **not** (a) add a fetch guard, nor (b) re-validate the **56 already-active discovered sources** — an already-active discovered source could still point anywhere. Containment scan today: 108 active feed sources, **0 non-https, 0 private/metadata** — structural gap, not currently exploited.
- **Real closure = this guard applied at `monitor-rss-sources:187`** + re-validating existing active source URLs on read. The propose gate reduces surface; the SSRF guard closes the fetch.

## Design — `_shared/safe-fetch.ts` (BUILT — see STATUS above)
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

## Adoption progress
- **Wave 1 (DONE 2026-08-02):** `monitor-rss-sources:187`. 108-feed re-validation through the guard → 0 rejected.
- **Wave 2 (DONE 2026-08-02):** `ingest-signal:653` **(C2 — RESOLVED: the one hand-confirmed finding from the whole scanner run is now guarded)**, `_shared/og-image.ts`, `_shared/media-capture.ts`, `backfill-signal-media` (×2), `ingest-expert-media`, `osint-web-search`, `test-osint-source-connectivity`. Shared helpers (og-image, media-capture) went live by redeploying their consumers (monitor-news-google, monitor-rss-sources; monitor-instagram, monitor-facebook).
  - **Re-scoped OUT:** `process-stored-document:24` — on inspection it is a generic **AI-API retry wrapper** (`fetchWithRetry(url, options, …, context='AI API')`), not a caller-supplied-URL fetch. Not SSRF-relevant; not guarded (would only add DNS latency to gateway calls). Flag if a document-URL fetch is later found there.
- **Wave 3 (DONE 2026-08-02, verify-then-guard):** guarded **`ingest-intelligence:29`** (`url = sourceData.url`, caller-supplied) and **`dashboard-ai-assistant:89`** (generic non-AI-gateway fetch helper). **Re-scoped OUT:** `incident-watch:249` + `voice-tool-executor-v2:305` — both build a **literal `googleapis.com/customsearch` URL** (fixed first-party API host; query is a param, not the host), not caller-supplied. **All 14 audited sites resolved:** 10 guarded, 4 re-scoped (process-stored-document + these 3 fixed-API-host callers).

### Redirect bypass (C) + og-image reason (D) + hardening (2026-08-02)
- **C — redirect bypass CLOSED (already):** tested through the deployed guard, a public host `302 → 169.254.169.254` is **BLOCKED on the redirect hop** (`SsrfBlockedError: private_ip`, `isSsrf:true`). `safeFetch` already does per-hop `redirect:'manual'` re-validation + hop cap — **no change to safe-fetch.ts needed.** `agent-sentinel` **Probe 2c extended** to assert the redirect case (fires if safe-fetch *follows* a public→private 302) in addition to the direct-address case.
- **D — og-image block reason:** the exact `safeFetch` call `extractOGImage` makes throws `SSRF blocked: private_ip (169.254.169.254)`. `extractOGImage`'s catch was swallowing it to `null`; **made fail-loud** — it now `console.warn`s the block reason (a swallowed security block is a doctrine violation).

### Wave-2 production proof + self-validation (2026-08-02)
- **C2 RESOLVED — proven in production, not just the diff.** A tripwire against the DEPLOYED guard (the exact `safeFetch` ingest-signal:653 calls, and the og-image `extractOGImage` path) blocked in ~1ms and allowed a public control:
  - metadata `169.254.169.254` → **BLOCKED** `private_ip` · link-local `169.254.1.1` → **BLOCKED** · RFC-1918 `10.0.0.1` → **BLOCKED** · `extractOGImage(metadata)` → **null** (no fetch) · control `https://example.com` → **ALLOWED 200**.
- **process-stored-document:24 descope CONFIRMED** — all 4 callers pass a **literal** endpoint (`api.openai.com/v1/responses`, `/v1/chat/completions`, plus vision/pro variants); `context='AI API'`. Not caller-supplied → not guarded. Descope stands.
- **Watchdog updated:** `agent-sentinel` **Probe 2c** = daily SSRF-guard self-validation canary (raises a `high` finding if `safeFetch` stops blocking metadata); `_shared/safe-fetch` added to the CLAUDE.md shared-helpers KB (the session-loaded knowledge base) with the no-raw-fetch-of-external-URL rule.

## Sequence
Build the shared guard → apply to the "confirmed" set first (starting `ingest-signal:653`) → the "verify" set → the source-table set. Wire it into fetch-url-content **before** that capability is restored. Track coverage explicitly (which fetch sites are guarded vs not) — an un-guarded caller-URL fetch is a finding.

## CLOSED 2026-08-11 — Wave 4 (the coverage sweep the acceptance requires) + closure
The genuine-closure discipline caught that this was NOT at ~90%: a full sweep of **every** raw `fetch()` on a non-literal URL (the WO's own acceptance — "an un-guarded caller-URL fetch is a finding") found sites Waves 1–3 never enumerated. Classified all of them:

**Guarded now (Wave 4) — genuinely caller/user-supplied host:**
- `dashboard-ai-assistant:10851` — `attachUrl` (a user chat-attachment URL fetched for vision). The sharpest gap; caller-supplied.
- `webhook-management:165` — `webhook.url` (user-configured outbound webhook; safeFetch blocks a webhook pointed at 169.254/private, allows public).
- `ingest-expert-media:373` — `channelUrl` (semi-supplied YouTube channel URL in the resolve path).
All three deployed; the try/catch at each site handles `SsrfBlockedError` gracefully (skip / fail the webhook test / return null).

**Re-scoped OUT (verified NOT caller-supplied — no guard needed):**
- **Hardcoded developer-controlled lists:** `monitor-news` (Direct-Canadian-news const array), `monitor-community-outreach` (`RSS_SOURCES`, `bandSites`), `monitor-regional-apac` (`APAC_SOURCES`).
- **Env-var / operator-configured:** `execute-approved-action` (`SLACK_ONCALL_WEBHOOK_URL`).
- **Fixed first-party / govt API hosts** (host literal, only query varies): all Google-CSE callers (`monitor-news-google`, `monitor-entity-proximity`, `scan-entity-content`, `osint-web-search:152`, `osint-entity-scan`, `perform-external-web-search`, `traveller-aegis-chat`, `monitor-regional-apac:236`), Meta Graph (`monitor-social-unified`, `monitor-instagram`), Twilio (`send-mfa-code`, `send-sms`), govt feeds (`monitor-weather`=weather.gc.ca, `monitor-cisa-kev`/`visibility-gap-scanner`=CISA KEV), `monitor-github`=raw.githubusercontent, AI-gateway retry wrapper (`process-stored-document`), internal (`dashboard-ai-assistant:11525`=wraith, `job-worker`=SUPABASE_URL-pinned), `system-ops:464`=uptime HEAD.
- **Host-constrained by a validator:** `monitor-rss-sources:36` — `jsonUrl` is only fetched after `isRedditPostUrl(postUrl)` passes (host pinned to Reddit).

**Coverage is now complete: every caller/source-supplied-URL fetch is behind `safeFetch`; every remaining raw `fetch()` is a fixed host, a hardcoded list, an env var, or validator-host-constrained.** The `agent-sentinel` Probe 2c self-validation canary (direct + redirect metadata block) remains the standing guarantee the guard keeps working. WO CLOSED.
