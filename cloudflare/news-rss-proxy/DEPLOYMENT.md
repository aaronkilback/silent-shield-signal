# news-rss-proxy — Deployment State + Triage Evidence (2026-07-11)

**PR context:** This PR (#123, `feat/news-rss-proxy-worker`) originally opened for the CF-Worker proxy to bypass Google's 503/429 on `news.google.com/rss` from Supabase egress IPs (issue #81). Closed 2026-07-11T19:47:20Z by aaronkilback; reopened 2026-07-11 during triage session after evidence of 6/6 active sources at 503 supported the COMMIT + WIRE disposition.

## Deploy state (verified via wrangler)

| Field | Value |
|---|---|
| Worker name | `news-rss-proxy` |
| Latest version | `0ca2e5a3-0416-4fef-ad6f-ac145893b30f` (redeployed 2026-07-11T20:39 UTC) |
| Prior versions | 2026-07-09: `5df3373d` (Upload 02:19:45), `f62f8bc1` (Secret Change 02:19:46), `05e69789` (Upload 02:19:57). 2026-07-11: `d905bbf6` (Secret Change 20:02, this session's rotation). |
| Deploy author | akilback@hotmail.com |
| CF subdomain | `akilback.workers.dev` |
| Public URL | `https://news-rss-proxy.akilback.workers.dev/` |
| Response at `/` | HTTP 403 (correct — refuses unauthenticated requests) |
| Secret name | `PROXY_SECRET` (secret_text) — rotated 2026-07-11 during triage |

**Redeploy 2026-07-11T20:39 UTC (version `0ca2e5a3-0416-4fef-ad6f-ac145893b30f`), reason:** deployed artifact predated the branch's session-authored code (2026-07-09 deploys were 19 min after commit `8c8b5f2b` was authored on the machine). CF OAuth token could not read deployed script content to make the diff definitive (API returned 10405 "Method not allowed for this authentication scheme" — script-content READ needs `Workers Scripts:Read` on an API token, not the OAuth token wrangler stores). Redeploy anchors the divergence question: **deployed code now equals branch worker.js** (commit `8c8b5f2b`, Chrome/124.0 UA on line 54). Post-redeploy direct probe still returns 503 with Google's block page (cf-ray `-YVR` Vancouver POP) — strong signal that Google's block is upstream-of-UA (IP-range on CF Worker egress), not UA-driven. Waiting one `monitor-rss-sources` cron cycle before escalating to option D (region/query variance).

## Triage evidence

### Query 1 — all news.google.com sources at 2026-07-11T19:08 (initial evidence)

At 19:08, ALL 6 active feeds were failing 503 Service Unavailable within seconds of each other. Alongside are 4 paused sources from the 2026-04-12 first-wave block whose recorded `error_message` still names the failure mode explicitly.

| id | name | status | last_ingested_at | error |
|---|---|---|---|---|
| `93a6bae1` | Wilderness Committee | active | 2026-07-11 19:08:45 | 503 Service Unavailable |
| `df18c8c9` | Activist Cash (Google News) | active | 2026-07-11 19:08:24 | 503 Service Unavailable |
| `139eb93b` | EcoExposed (Google News) | active | 2026-07-11 19:08:23 | 503 Service Unavailable |
| `8ef32729` | Canada National Observer | active | 2026-07-11 19:08:23 | 503 Service Unavailable |
| `1a1b7341` | BC Energy Regulator | active | 2026-07-11 19:08:16 | 503 Service Unavailable |
| `3c47767a` | BC Activist Network Funding Watch | active | 2026-07-11 19:08:10 | 503 Service Unavailable |
| `1510eb4e` | Google News: STAND Earth | paused | 2026-04-12 13:30:11 | (empty; paused) |
| `c347193d` | Google News: Dogwood BC | paused | 2026-04-12 13:30:11 | (empty; paused) |
| `30944607` | Google News: Gidimt'en Checkpoint | paused | 2026-04-12 13:30:09 | 503 Service Unavailable — Google blocks RSS scraping from Supabase edge function IP ranges. Replaced by direct feeds. |
| `9fb2c172` | Google News: Petronas breach ransomware | paused | 2026-04-12 13:30:06 | Same message |

### Query 2 — same 6 active sources at 2026-07-11T19:53 (~45 min later)

All 6 flipped to `succeeded`. Google's block is **INTERMITTENT** across the two windows, not stable. The proxy still improves reliability — a smoother path over intermittent 503s.

| Name | last_attempt_at | state | last_signal_produced_at | coverage_gap |
|---|---|---|---|---|
| Canada National Observer | 2026-07-11 19:53:17 | succeeded | 2026-07-10 09:09 | 1 day since last signal |
| BC Energy Regulator | 2026-07-11 19:53:18 | succeeded | 2026-06-22 16:57 | **19 days since last signal** |
| EcoExposed (Google News) | 2026-07-11 19:53:23 | succeeded | null | **never produced a signal** |
| BC Activist Network Funding Watch | 2026-07-11 19:53:10 | succeeded | null | **never produced a signal** |
| Wilderness Committee | 2026-07-11 19:53:43 | succeeded | null | **never produced a signal** |
| Activist Cash (Google News) | 2026-07-11 19:53:26 | succeeded | null | **never produced a signal** |

Coverage-gap query:
```sql
WITH src AS (
  SELECT id, name, last_ingested_at, error_message FROM sources
  WHERE status='active' AND (config->>'feed_url') ILIKE '%news.google.com%'
),
last_signal AS (
  SELECT s.source_id, MAX(s.created_at) AS last_signal_at FROM signals s
  WHERE s.source_id IN (SELECT id FROM src) GROUP BY s.source_id
)
SELECT src.name, src.last_ingested_at::timestamp AS last_attempt_at,
  CASE WHEN src.error_message IS NULL OR src.error_message = ''
       THEN 'succeeded' ELSE 'failed_503' END AS last_attempt_state,
  ls.last_signal_at::timestamp AS last_signal_produced_at
FROM src LEFT JOIN last_signal ls ON ls.source_id = src.id
ORDER BY ls.last_signal_at DESC NULLS LAST;
```

## Telemetry blindness — motivating case for the source health registry

`cron_heartbeat` for `monitor-rss-sources` over the 14-day window shows **355 runs, all `completed`, zero failures**. But per-source outcome tracking (this file's Query 1) shows 6-of-6 per-source failures on the same window. **Job-level heartbeat "succeeded" cannot substitute for per-source outcome tracking.** This is the motivating case to reference in `docs/platform-operations/wo-coverage-source-health-registry-spec.md` when WO-COVERAGE Phase 2 is scheduled.

## One-feed test plan (per operator ruling 2026-07-11)

**Candidate:** `1a1b7341-0b85-417f-9f3f-34862b72641c` — BC Energy Regulator (safe tenant-scoped operational context, low signal-relevance blast radius, 19-day signal gap makes the improvement measurable).

**Repoint:** `sources.config.feed_url` changes from
```
https://news.google.com/rss/search?q=BCER+OR+%22BC+Energy+Regulator%22&hl=en-CA&gl=CA&ceid=CA:en
```
to
```
https://news-rss-proxy.akilback.workers.dev/rss/search?q=BCER+OR+%22BC+Energy+Regulator%22&hl=en-CA&gl=CA&ceid=CA:en&s=<PROXY_SECRET>
```

Only BC Energy Regulator is repointed. The other 5 remain on direct URLs pending a separate operator go.

**Pass criterion:** on the next `monitor-rss-sources` fetch cycle (every ~15 min), the BC Energy Regulator source must show:
- `last_ingested_at` advanced
- `error_message` empty
- Items scanned > 0
- At least one derived signal within the following ~24 h (or explicit "0 items in feed for this query today" if Google's own search returns no fresh items — Google would still return 200 with an empty feed)

## Security notes

1. **Proxy secret rides in the query string (`?s=<PROXY_SECRET>`) inside `sources.config`.** This is acceptable given the worker's implicit host lock (worker.js only ever rebuilds `news.google.com` URLs, never accepts a target host from the caller — not an open proxy). Query-string secrets are visible to CF Access Logs and to Cloudflare's Analytics but not to callers of the worker or to the DNS layer. The secret has been rotated 2026-07-11 during this triage session.
2. **Header-based auth (future hardening).** Repointing to headers (e.g., `X-Proxy-Secret`) removes the secret from URL/logs but requires monitor-rss-sources to attach a request header when fetching, which is a code change. Flagged as a follow-up item — not blocking this one-feed test.

## Hold order

After the one-feed test passes on BC Energy Regulator: **do NOT repoint the other 5** without a separate go from the operator. The batch repoint is its own reviewed step.

The local `~/.fortress-proxy-secret` file (0600 perms, 65 bytes) will be deleted after the one-feed test passes AND the remaining 5 feeds are ruled on.
