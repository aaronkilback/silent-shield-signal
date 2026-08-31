# WO-SIGNAL-STALL — zero signals in 24h; is collection dark or is ingest broken?

**Status:** report only. **Do NOT fix.** **Opened:** 2026-08-31.

## The trigger
Today's briefing: **zero signals in 24 hours**. `monitor-twitter` dark for the comparison period; **4
monitors failed** during the window. The platform is not currently monitoring.

## Questions (Step 1)
1. Which 4 monitors failed, and with what error.
2. When did `monitor-twitter` go dark, and why.
3. Is the zero-signal condition explained ENTIRELY by those five, or is **ingest broken downstream of
   collection** (collection running, writes failing)?
4. Last successful signal write: timestamp and source.

## Do NOT
Report only. Do not restart monitors, do not re-enable anything, do not touch the pipeline.

## Step 1 findings (2026-08-31) — NOT a pipeline break; thin weather-dependent coverage
**Q4 — last signal:** `SIG-2026-035474`, **2026-08-28 18:09:17Z**, origin **monitor-rss-sources**
("Tate Johnson's Whitecaps extension"). Last NAAD (weather) signal 2026-08-28 17:47. Max signal_number
confirms nothing inserted since. 576 signals in 7d — **565 were monitor-naad-alerts (weather)**.

**Q1 — which monitors failed:** NOT four. In 72h exactly **1** monitor run failed: `monitor-geo-wildfire-30min`
once at 2026-08-29 15:43 (HTTP2 connection error to BC ArcGIS evacuation FeatureServer — transient, recovered;
subsequent runs succeeded). **Every other monitor succeeded every run.** The briefing's "4 failed" is not
corroborated by cron_heartbeat — it appears to conflate 0-yield/quiet monitors with "failed" (reporting-layer
mislabel, same family as WO-CHRONIC-CLASSIFIER / the P1.4 pause-blindness).

**Q2 — monitor-twitter:** RETIRED 2026-05-22 (PROD-M; cron+registry removed; X API budget). Never a heartbeat
(`twitter_last_heartbeat` NULL). Dark ~3.5 months, deliberately — not a failure; should not sit in a live
"comparison period."

**Q3 — collection vs ingest:** neither is "broken." Monitors RUN and SUCCEED; the four-stage funnel runs
end-to-end and is instrumented current to 16:54 (parse→client_match→relevance_score→insert; docs ingested
165/6h, all processed within seconds). The zero-signal is (a) **NAAD legitimately dry** — the severe-thunderstorm
event ended ~Aug 28; recent runs scan 223 alerts and filter ALL (out-of-area/low-priority/French); and
(b) the **RSS funnel at its normal near-zero yield.**

### client_match (per operator) — the matcher is NOT rejecting its entire input
- **Predicate** (`matchClientKeywords`, process-intelligence-document): case-insensitive **substring** of doc
  text against each `status='active'` client's `name` (+1000), each `monitoring_keywords` entry
  (+len+words*10), `competitor_names`, `high_value_assets`; **tier-2 fuzzy** (industry-tier keyword +
  regional anchor → score 10) only when no direct hit. Highest-scoring single client wins.
- **Reference data:** `clients` table (active only) — **INTACT**: Petronas 39 kw / BC Place 37 kw, updated
  2026-08-26. (Also active: Kilbacks 0 kw, __platform_security__ 0 kw, _qa_alert_render 0 kw.)
- **Ever passed / last pass:** YES — **14 client_match passes in 7d** (last 2026-08-30 03:39); but only **4**
  reached `insert` (last **2026-08-28 18:09**); the middle drop is `relevance_score` (<0.3). So ~**99.6%**
  drop at client_match (client-irrelevant general news), **not 100%** — my earlier 6h-window "100%" overstated
  it. Not the corroboration-gate "reject entire input" shape.
- **Changed recently / deploy:** NO. Deployed **v161, 2026-08-25 22:04Z** (predates the stall by 3 days); no
  recent commit touches `matchClientKeywords` (last change = the May tier-2 fuzzy). **No silent
  matcher-changing deploy.**

**Real finding (report only):** coverage is **thin and weather-dependent** — 98% of 7d signal volume was
episodic NAAD weather; RSS yields ~0.4% (client-irrelevant); social/news monitors run but yield ~nothing
(social-dryup / news-allowlist lineage). "Platform not monitoring" is inaccurate (it runs); "platform has
almost no real signal coverage beyond episodic weather" is the true, more serious finding. WO-COVERAGE
territory. No fix here.
