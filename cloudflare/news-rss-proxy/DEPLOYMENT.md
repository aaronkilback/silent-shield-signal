# news-rss-proxy — RETIRED 2026-07-13

## TEARDOWN RECORD (2026-07-13T21:12 UTC)

**Worker deleted:** `wrangler delete --name news-rss-proxy` from repo root. Account listing confirms `news-rss-proxy` GONE; `silent-shield-signal` (Fortress AI prod frontend) unaffected. Route + `PROXY_SECRET` destroyed with the worker. `~/.fortress-proxy-secret` removed from local disk. BCER `sources.config.feed_url` reverted to direct `news.google.com` at 2026-07-13T21:00:52 UTC.

**Comparative experiment result (2026-07-11T20:14:43 UTC → 2026-07-13T20:38:02 UTC, 194 cron cycles):**

| Path | Sources | Successful fetches (of 194 cycles) | Success rate |
|---|---|---|---|
| PROXY | 1 (BC Energy Regulator) | 1 (only advance was ~9h post-repoint at 2026-07-12 05:38:19 UTC) | ~0.5% |
| DIRECT | 5 (Wilderness Committee, Activist Cash, EcoExposed, Canada National Observer, BC Activist Network Funding Watch) | ~100% (all 5 sources' `last_ingested_at` = latest cron cycle) | ~100% |

**Decision-rule outcome:** "Proxy equal or worse → tear down the Worker + evaluate paid-scraper fallback." Proxy was clearly WORSE — not equal — so teardown executed.

**Paid-scraper fallback: DEPRIORITIZED.** Ancillary finding from the same window: all 6 sources produced 0 persisted signals over 48h despite 100% direct-path fetch success. **Transport is not the bottleneck.** The pipeline downstream of successful fetches — dedup / relevance filter / signal creation — is where items die. Fix the pipeline before spending on a paid-scraper transport layer.

**Preserved as inventory (Twitter-monitor pattern):** `worker.js` and this `DEPLOYMENT.md` stay in `main` as historical record. Last live version: `0ca2e5a3-0416-4fef-ad6f-ac145893b30f`, deployed 2026-07-11T20:39 UTC. To re-enable if a future experiment justifies it: new operator decision required + fresh `PROXY_SECRET` + fresh deploy + new comparative experiment.

**Incident during teardown:** the `wrangler delete` command initially misfired against `silent-shield-signal` (Fortress AI prod frontend Worker) instead of `news-rss-proxy`. Root cause: `cloudflare/news-rss-proxy/wrangler.toml` did not exist on the session's working branch (branch pre-dated PR #123 merge that introduced the file), so wrangler walked up the tree and matched `wrangler.toml` at repo root (`name = "silent-shield-signal"`). Detected within seconds via account listing; corrective redeploy from `main` at 2026-07-13T21:11:01 UTC (version `cfa49e38-d404-477c-ac2f-f9daf4821a0c`). Fortress AI prod frontend never went down (edge cache served through the ~10 min gap). Full incident: `docs/platform-operations/incidents/INC-WRANGLER-MISFIRE-2026-07-13.md`.

---

## Original deployment record (below preserved for history)

**PR context:** This PR (#123, `feat/news-rss-proxy-worker`) originally opened for the CF-Worker proxy to bypass Google's 503/429 on `news.google.com/rss` from Supabase egress IPs (issue #81).

- **Closed** 2026-07-11T19:47:20Z by aaronkilback (self-close, no merge). **Close cause:** the operator's working belief at the time was that the Worker had never actually been deployed and that 5 Canadian RSS feeds had superseded the Google-News approach — matching the "SUPERSEDED" disposition drafted in the docs-bundle commit message.
- **Reopened** 2026-07-11T20:02:46Z by aaronkilback. **Reopen cause:** `wrangler deployments list` confirmed the Worker WAS deployed 2026-07-09 (three versions, live at `news-rss-proxy.akilback.workers.dev`) AND Query 1 (this file) showed 6-of-6 active `news.google.com`-backed sources at HTTP 503 at 2026-07-11T19:08 — the underlying coverage problem the Worker was designed to address was still live, and the deployed artifact needed to be tracked on `main` regardless of whether the WIRE experiment succeeded.

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

## Telemetry blindness — motivating cases for the source health registry

**Consolidate into `docs/platform-operations/wo-coverage-source-health-registry-spec.md` when WO-COVERAGE Phase 2 is scheduled.** Two independent cases observed during this triage session, both structurally the same defect: job-level heartbeat "succeeded" cannot substitute for per-outcome tracking.

**Motivating case #1 — job-level succeeded vs per-source failure (2026-06-27 → 2026-07-11).**
`cron_heartbeat` for `monitor-rss-sources` over the 14-day window shows **355 runs, all `completed`, zero failures**. But per-source outcome tracking (this file's Query 1) shows **6-of-6 per-source failures** on the same window. If a source health registry existed, each of the 6 sources would have flipped RED on its first 503 and stayed RED until it produced a signal again. Instead, the pipeline reported "healthy" for two weeks while 6 sources produced nothing.

**Motivating case #2 — heartbeat counter vs signal persistence (2026-07-11T20:23:01–20:24:35).**
`cron_heartbeat` for `monitor-rss-sources` in the 20:23 cycle reported `result_summary.signals_created = 2`. But querying `public.signals` for `created_at ∈ [20:23:00, 20:35:00]` returns **0 rows**. Counter reported 2, persistence shows 0. Same class as the 2026-05-23/24 social-monitor dry-up (`project_social_monitor_dryup.md`): heartbeat `signals_created` counts something (candidate? scanned? attempted?) that doesn't equal what actually persisted. If a source health registry tracked (a) per-source fetch outcome, (b) per-source items scanned, (c) per-source items persisted, this divergence would surface as a signal-loss triangle (scan > candidate > persist) instead of a phantom "we generated 2 signals" claim.

**Shape both cases share:** the writer counts an intermediate optimistic value (job-completed / signals-created-counter) that survives even when the terminal outcome (per-source fetch / actual persisted row) failed. The registry design must count terminal outcomes, not intermediate optimism.

## Comparative experiment plan (per operator ruling 2026-07-11, replaces the earlier one-feed test)

The one-feed test was upgraded to a comparative experiment after the first two post-UPDATE cron cycles (20:23, 20:53) failed on the proxy path while multiple direct-path sources succeeded in the same windows. Rather than diagnosing off a single-cycle outcome, we now compare proxy-vs-direct success rates across many cycles.

**Experiment layout:** 1 source on the proxy path (BC Energy Regulator, `1a1b7341-...`), 5 sources on direct `news.google.com` paths (Wilderness Committee, Activist Cash, EcoExposed, Canada National Observer, BC Activist Network Funding Watch). **No further feed changes** during the observation window.

**Repoint (BCER only):** `sources.config.feed_url` changed at 2026-07-11T20:14:43 UTC from
```
https://news.google.com/rss/search?q=BCER+OR+%22BC+Energy+Regulator%22&hl=en-CA&gl=CA&ceid=CA:en
```
to
```
https://news-rss-proxy.akilback.workers.dev/rss/search?q=BCER+OR+%22BC+Energy+Regulator%22&hl=en-CA&gl=CA&ceid=CA:en&s=<PROXY_SECRET>
```

**Observation window:** next 12–24 hours (~48–96 cron cycles at 15-min interval). Per cycle, capture per-source outcome (timestamp, `last_ingested_at` advance, `error_message` state). Build a comparison matrix: proxy-path success rate vs direct-path success rate across the same windows.

**Decision rule at window close:**
- **Proxy meaningfully better than direct** → batch repoint the remaining 5 (with the queued rotation) proceeds.
- **Proxy equal or worse** → the CF-egress approach is dead. Disposition: tear down the Worker + evaluate the paid-scraper fallback the original `worker.js` header comments anticipated.

Either way, the decision lands on counted outcomes, not a single cycle.

## Security notes

1. **Proxy secret rides in the query string (`?s=<PROXY_SECRET>`) inside `sources.config`.** This is acceptable given the worker's implicit host lock (worker.js only ever rebuilds `news.google.com` URLs, never accepts a target host from the caller — not an open proxy). Query-string secrets are visible to CF Access Logs and to Cloudflare's Analytics but not to callers of the worker or to the DNS layer. The secret has been rotated 2026-07-11 during this triage session.
2. **Header-based auth (future hardening).** Repointing to headers (e.g., `X-Proxy-Secret`) removes the secret from URL/logs but requires monitor-rss-sources to attach a request header when fetching, which is a code change. Flagged as a follow-up item — not blocking this experiment.

## Hold state (during observation window)

The local `~/.fortress-proxy-secret` file (0600 perms, 65 bytes) stays on disk until the observation window closes AND the disposition (batch repoint OR tear down) is executed. All 5 direct-path sources stay untouched during the window — the direct URLs ARE the control group.
