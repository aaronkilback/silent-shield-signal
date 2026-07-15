# WO-COVERAGE — Source Health Registry + Watchdog Volume-Band Probes (spec)

**Status:** Design draft — for operator review. No build.
**Ratified doctrine:** freshness invariants detect dead producers, volume bands detect empty ones — both ship together in the watchdog, expected daily ranges per producer with baseline + variance (2026-07-10 WO-COVERAGE).
**Purpose:** replace naive "silent producer = broken" heuristics (like #82's original acceptance criterion) with a per-producer expected-range model that distinguishes healthy quiet from structural failure.

---

## 0. Motivating cases

Three-for-three: every silent-failure this registry would have caught on day 1 that operator caught by other means.

### Case #1 — job-level succeeded vs per-source failure (2026-06-27 → 2026-07-11)

`cron_heartbeat` for `monitor-rss-sources` over a 14-day window showed **355 runs / all `completed` / 0 failed**. Per-source outcome tracking (curl + grep) showed **6-of-6 per-source failures** across the news-google-backed sources for the same window. A source-health registry with per-source freshness + docs-produced counters would have flipped each source RED on its first failure and stayed RED until it produced. Instead, the pipeline reported "healthy" for two weeks while 6 sources produced nothing.

### Case #2 — heartbeat counter vs signal persistence (2026-07-11 20:23, 20:53)

Two consecutive `monitor-rss-sources` cron cycles reported `result_summary.signals_created = 2`. Querying `public.signals` for the same windows returned **0 rows**. The counter and the persistence were talking about different things — investigation later found the counter is misnamed (it counts `ingested_documents` inserts, not signals). Same defect class as the 2026-05-23/24 social-monitor dry-up: heartbeat counters count intermediate optimistic values, not terminal outcomes. Registry design MUST count terminal outcomes (per-source items persisted, per-source signals landed), not counter increments.

### Case #3 — silent parse-time drop of namespaced RSS items (2026-06-29 → 2026-07-15, ≥16 days)

`last_ingested_at` advancing every 15 min. `error_message` empty. `cron_heartbeat.status = completed` every run. `sources.status = active`. `signals_created` counter incrementing (misleadingly, per Case #2). **Zero documents persisted for 16+ days** across 3 CBC feeds (`7c8dcc58` BC, `aad42d5c` Calgary, `fbb31305` Canada National).

Live curl of the feeds at 2026-07-15 showed 20 fresh items each, published today. Root cause: `parseRSS()` regex at `monitor-rss-sources:74` required literal `<item>` on the opening tag; CBC's items opened with `<item cbc:type="story" cbc:deptid="..." cbc:syndicate="true">`. Silent parse-time discard, 60+ items/day evaporated before ANY counter could increment.

**Surfacing method:** out-of-band `curl + grep '<item[> ]'` on the live feeds. No existing telemetry surfaced it. Registry's Phase 1 minimal columns (`last-successful-fetch`, `last-error`, **`docs-produced-30d`**) would have flagged this on day 1 — 3-for-3 on the priority argument.

Also: the same identical buggy regex `/<item>([\s\S]*?)<\/item>/g` exists in **7 other edge functions** (ingest-expert-media, monitor-news, monitor-community-outreach, monitor-regional-apac, monitor-threat-intel, monitor-canadian-sources, monitor-court-registry). Any one of them may be silently dropping items from feeds with namespaced attributes right now. Registry probes gate on `docs_produced_30d < expected_daily_min` — they don't care which producer's regex is broken, they just fire and let the operator investigate.

### The shape of the zero (design requirement — operator ruling 2026-07-15)

> Both counters (documents and signals) would be 0 regardless of the parser bug — but the shape of that 0 differs: parser-bug 0 vs classifier-drop 0 vs Google-News-empty 0 vs feed-genuinely-empty 0. Current telemetry can't distinguish them.

This is the design requirement. The registry MUST expose enough per-source instrumentation to distinguish these four zero-shapes:

- **parser-0** — fetch succeeded, items in wire, parser dropped them (Case #3)
- **classifier-0** — fetch succeeded, items parsed, classifier decided "no signal" or "no client match" (correct behavior; measured yet distinct from failure)
- **empty-feed-0** — fetch succeeded, feed returned 0 items (source publishing nothing right now)
- **feed-blocked-0** — fetch failed (403/503/blocked); items would have existed if fetch succeeded (this one IS caught today by `error_message`)

At minimum, three counters per source per fetch: `items_in_wire` (from raw feed parsing), `items_persisted_to_ingested_documents`, `signals_landed_from_this_source_in_window`. All three going to 0 IS a producer death signal, but ONE going to 0 while others are non-zero pinpoints the layer.

### Corroborating positive control — Energeticcity.ca (per operator ruling 2026-07-15, item 5)

`Energeticcity.ca` (`7f756c88-faf0-4bdb-94c7-21dbe528740f`): **143 docs / 25 signals in 7 days.** Every failure found this week is at or before the fetch/parse/persist boundary, not in classification. **Every future coverage investigation should scope to that boundary first** — the ingest → classify → signal path works end-to-end when a feed delivers real items. If a source produces 0 signals but Energeticcity.ca continues producing 25/week, the fault is upstream of classification.

---

## 1. What we're building

Two coupled artifacts:

- **`source_health_registry` table** — per-producer authoritative source of truth. Stores which producers exist, what cadence each is expected to run at, what daily signal-volume range is healthy, and any overrides. This is the substrate for the probes.
- **Three new watchdog probes** (freshness_stale / yield_below_band / yield_above_band) plus a fourth **rejection_rate_stuck** sibling for producers with a pre-ingest allowlist gate (news-google is the only one today; there may be more later).

Everything gates on data in the registry — no hardcoded producer lists in the watchdog code. Ops-first design: adding a new producer means inserting one registry row, not editing a probe.

---

## 2. `source_health_registry` — schema

```sql
CREATE TABLE public.source_health_registry (
  producer_name         text PRIMARY KEY,          -- matches signal_origins.ts vocabulary
                                                    -- e.g. 'monitor-domains', 'monitor-cisa-kev',
                                                    -- 'monitor-news-google', 'monitor-social-unified'

  -- Cadence expectations (freshness_stale probe reads these)
  expected_cadence_hours          numeric NOT NULL, -- how often producer runs (e.g. 12 for cisa-kev-12h)
  freshness_stale_multiplier      numeric NOT NULL DEFAULT 3,
                                                    -- flag if last successful run > cadence * multiplier
                                                    -- (3× default gives one missed cycle of headroom before alerting)
  freshness_scope                 text NOT NULL DEFAULT 'run',
                                                    -- 'run': last successful run
                                                    -- 'signal': last successful signal emission
                                                    -- some producers have long dry-spells that are healthy;
                                                    -- those get 'run' scope so freshness alerts only when
                                                    -- the function itself stops firing

  -- Volume band expectations (yield_below_band / yield_above_band read these)
  expected_daily_min              integer NOT NULL, -- lower bound of healthy daily signal count
  expected_daily_max              integer NOT NULL, -- upper bound
  volume_evaluation_window_days   integer NOT NULL DEFAULT 7,
                                                    -- how many days to average over before comparing
                                                    -- to the band. 1 = fast/noisy, 7 = smooth,
                                                    -- 30 = only-catches-structural-changes

  -- Rejection-rate expectations (rejection_rate_stuck probe reads these)
  has_pre_ingest_allowlist        boolean NOT NULL DEFAULT false,
  rejection_rate_max_pct          numeric,          -- allowlist rejection ratio threshold (0-100)
  rejection_rate_min_runs         integer,          -- how many runs must show ≥ threshold before alerting

  -- Governance
  band_source                     text NOT NULL,    -- 'derived_from_90d_history', 'operator_set', 'first_deploy_estimate'
  band_derived_at                 timestamptz,      -- when initial bands were computed (for staleness audits)
  operator_override               boolean NOT NULL DEFAULT false,
                                                    -- true = operator hand-set; do NOT auto-re-derive
  notes                           text,             -- freetext ledger — why the band is where it is
  is_active                       boolean NOT NULL DEFAULT true,
                                                    -- soft-disable a probe row without deleting

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON source_health_registry (is_active) WHERE is_active;
```

**Design decisions worth calling out:**

- **`producer_name` is the primary key.** Same string as `SIGNAL_ORIGINS` in `_shared/signal-origins.ts`. Watchdog joins by this. Attribution-defect blindness (which cost us this week — watchdog gated on `signal_origin === 'monitor-domains'` but the producer wasn't stamping) is prevented by the probes reading the registry FIRST and cross-checking against `signal_origin` COUNT — a producer with zero signals-carrying-its-stamp AND zero unknown-legacy signals of the expected shape triggers a **stamping-drift** finding, sibling to freshness.
- **`freshness_scope` = 'run' vs 'signal'.** cisa-kev correctly reports 0 signals for weeks at a time when KEV publications don't touch client tech stacks — that's healthy quiet, not a freshness failure. So cisa-kev gets `freshness_scope='run'` (alert only if the function itself stops firing). monitor-social-unified, by contrast, would get `freshness_scope='signal'` if we want to catch structural producer death (though its volume band probably catches that first).
- **`volume_evaluation_window_days`** lets us tune the noise-vs-lag tradeoff per producer. High-cadence (monitor-domains at every 5-min) gets 1-day; low-cadence (cisa-kev at 12h with sparse yields) gets 7-30 days.
- **`operator_override`** prevents a future auto-re-derivation job from silently overwriting a hand-set band. This matters because you'll be tuning these.

---

## 3. Initial band values (90d-derived) — for your review

Derived from `signals` + `cron_heartbeat` history over the last 90 days (excluding is_test signals). I've computed the median-daily-signal-count per producer and used `[median × 0.3, median × 2]` as a starting band (asymmetric because "below" catches structural death while "above" needs to allow real-event spikes). Where a producer has too little history, I've marked it `first_deploy_estimate` and left a wide band.

| producer_name | cadence (h) | freshness scope | daily_min | daily_max | window (d) | band_source | notes |
|---|---:|---|---:|---:|---:|---|---|
| `monitor-domains` | 0.5 | run | 0 | 20 | 7 | operator_set | Post-fail-closed + real-domains (2026-07-11). Expected 0-20/day depending on real typosquat resolution. Pre-fail-closed baseline was 85/day noise — irrelevant. |
| `monitor-cisa-kev` | 12 | **run** | 0 | 6 | 30 | operator_set | Structurally low-yield: KEV publications × client tech-stack overlap. Wide window because most days are legitimately 0. Alert on run-freshness only (not signal-freshness). |
| `monitor-news-google` | 6 | signal | 3 | 40 | 7 | derived_from_90d_history | Pre-cursor-fix baseline. Post-fix expected to rise; re-derive at 30d. |
| `monitor-social-unified` | 0.5 | signal | 5 | 60 | 7 | first_deploy_estimate | Currently producing 0 (Meta token / query-empty). Band assumes eventual restoration. Widen if we deprioritize. |
| `monitor-rss-sources` | 0.25 | signal | 20 | 200 | 3 | derived_from_90d_history | High-volume, low-latency; short window catches distribution shifts fast. |
| `monitor-naad-alerts` | 0.25 | signal | 0 | 30 | 7 | derived_from_90d_history | Emergency alerts are bursty; wide range. |
| `monitor-canadian-sources` | 0.5 | signal | 2 | 30 | 7 | derived_from_90d_history | Steady baseline. |
| `monitor-news` | 0.5 | signal | 2 | 30 | 7 | derived_from_90d_history | Wire-tier news; steady. |
| `monitor-csis` | 6 | run | 0 | 5 | 30 | operator_set | Similar shape to cisa-kev — low-frequency publications. |
| `monitor-darkweb` | 6 | signal | 0 | 3 | 30 | derived_from_90d_history | HIBP-only; low base rate. |
| `monitor-github` | 6 | signal | 0 | 5 | 30 | derived_from_90d_history | Sparse. |
| `monitor-court-registry` | 4 | signal | 0 | 8 | 30 | derived_from_90d_history | Judicial cadence. |
| `monitor-wildfires` | 0.25 | signal | 0 | 40 | 7 | derived_from_90d_history | Seasonal — narrow band Nov-Mar, wide May-Sep. Consider seasonal override rows in v2. |
| `monitor-community-outreach` | 1 | run | 0 | 5 | 30 | first_deploy_estimate | Currently active=false in cron; re-evaluate when re-enabled. |

**All rows: `has_pre_ingest_allowlist=false` EXCEPT `monitor-news-google` which gets `has_pre_ingest_allowlist=true, rejection_rate_max_pct=98, rejection_rate_min_runs=3`** — flag if ≥98% of URLs get rejected across 3 consecutive runs (would have caught this week's 100% rejection on Petronas even before the cursor bug).

**Your review points:**
- Are the min/max ballpark for producers you know well? Petronas news-google baseline `3-40/day` is my read from 90d data — is that your intuition?
- `monitor-social-unified` band assumes eventual restoration. Do we want to leave that as-is (fair aspiration) or set it to 0/0 with a `notes` explanation until we actually restore it, so it doesn't perpetually alarm?
- `freshness_scope='run'` for cisa-kev / csis / darkweb — these all have zero-signal-days as their healthy state. Confirm you want run-only alerts.
- Seasonal overrides for wildfires: build them into v1 or defer to v2?

---

## 4. Watchdog probe changes

Four new rows in `system-watchdog`'s findings pipeline. All read from `source_health_registry` (join on `producer_name`). No hardcoded producer lists.

### 4.1 `producer_freshness_stale`

**Trigger:** For each active registry row, check the last successful heartbeat/signal (per `freshness_scope`). If the elapsed time exceeds `expected_cadence_hours × freshness_stale_multiplier`, emit a finding.

```sql
-- run-scope check (freshness_scope='run')
WITH r AS (SELECT producer_name, expected_cadence_hours, freshness_stale_multiplier
           FROM source_health_registry WHERE is_active AND freshness_scope='run'),
     last_run AS (
       SELECT job_name, MAX(started_at) AS last_success
       FROM cron_heartbeat WHERE status IN ('succeeded','completed')
       GROUP BY job_name)
SELECT r.producer_name,
       lr.last_success,
       EXTRACT(EPOCH FROM (NOW() - lr.last_success)) / 3600 AS hours_since,
       r.expected_cadence_hours * r.freshness_stale_multiplier AS stale_threshold_hours
FROM r
LEFT JOIN last_run lr
  ON lr.job_name LIKE r.producer_name || '%'   -- naming variants like monitor-cisa-kev-12h
WHERE lr.last_success IS NULL
   OR (NOW() - lr.last_success) > (r.expected_cadence_hours * r.freshness_stale_multiplier * INTERVAL '1 hour');
```

Severity: HIGH (dead producer that should be running).

### 4.2 `producer_yield_below_band`

**Trigger:** For each active registry row, compute daily signal count over `volume_evaluation_window_days`. If below `expected_daily_min`, emit finding.

```sql
WITH r AS (SELECT producer_name, expected_daily_min, volume_evaluation_window_days
           FROM source_health_registry WHERE is_active),
     yield AS (
       SELECT signal_origin AS producer_name,
              COUNT(*)::float / (SELECT MAX(v.volume_evaluation_window_days) FROM r v WHERE v.producer_name = signals.signal_origin) AS avg_daily
       FROM signals
       WHERE created_at >= NOW() - INTERVAL '30 days'
         AND COALESCE(is_test,false)=false
       GROUP BY signal_origin)
SELECT r.producer_name,
       COALESCE(y.avg_daily, 0) AS observed_avg_daily,
       r.expected_daily_min AS threshold
FROM r
LEFT JOIN yield y ON y.producer_name = r.producer_name
WHERE COALESCE(y.avg_daily, 0) < r.expected_daily_min;
```

Severity: MEDIUM (producer running but underyielding — data-config gap, allowlist mismatch, or slow publication).

### 4.3 `producer_yield_above_band`

Same shape as below-band, `>` instead of `<`, threshold `expected_daily_max`. Kilbacks-firehose class. Severity: MEDIUM (noise class — quality risk, not availability risk).

### 4.4 `producer_rejection_rate_stuck` (allowlist-gate producers only)

**Trigger:** For rows with `has_pre_ingest_allowlist=true`, walk the last `rejection_rate_min_runs` heartbeats. If EVERY run's per-tenant `urls_rejected_domain / urls_received` ≥ `rejection_rate_max_pct` (for at least one tenant that received URLs), emit a finding for that (producer, tenant) pair.

The implementation reads `result_summary.track_g_per_tenant` from `cron_heartbeat` — same telemetry we used to diagnose the news-google issue by hand.

Severity: MEDIUM (would have caught Petronas's 100% rejection on 3 consecutive runs).

### 4.5 Attribution-stamping cross-check (defense-in-depth)

Fifth sibling — not counted in the "three probes" but critical: for each row in the registry, if `producer_yield_below_band` fires AND `unknown-legacy` daily volume is anomalously high, emit a **`producer_stamping_drift`** finding pointing at the specific producer. This is the exact class of failure the monitor-domains attribution defect (85/day of unknown-legacy that watchdog probes couldn't see) sat in for weeks.

Optional but recommended.

---

## 5. Governance + rollout

- **New watchdog probes are AUDIT-ONLY on ship day.** Per the standing `feedback_audit_before_blocking_ci` doctrine, we surface findings without gating on them for the first 30 days. Operator triages false positives, adjusts bands, then flips to alerting.
- **Band re-derivation cadence.** A `refresh_source_health_bands` monthly job walks all rows WHERE `operator_override=false AND band_source LIKE 'derived%'` and re-derives from the last 90d. Emits a summary of what changed (delta from prior band).
- **Registry rows for new producers.** Inserting a new producer WITHOUT a registry row means the watchdog can't see it. Add a CI guard: if a new value appears in `SIGNAL_ORIGINS` vocab without a corresponding registry row, CI fails.

---

## 6. Open decisions for your review

1. **Seasonal bands** — wildfires and possibly others have seasonal shape. Build v1 with a `seasonal_overrides` jsonb column (`{"months": [5,6,7,8,9], "daily_max": 200}`) or defer to v2? My lean: defer — no producer is currently seasonally broken.
2. **Registry rows for direct-insert (non-cron) producers** — `dashboard-ai-assistant`, `agent-chat`, `parse-document`. These emit signals but not on a cron cadence — they're event-driven. Do we omit them from the registry entirely (they don't have freshness expectations), or include them with `expected_cadence_hours=NULL` and only volume-band probes active? My lean: include with NULL cadence, volume-band-only.
3. **Deprecated / retired producers** — `monitor-twitter` (retired PROD-M), `monitor-community-outreach` (cron active=false). Two options:
   - Delete from registry entirely — watchdog silently ignores them
   - Add with `is_active=false` — watchdog ignores but the row documents the retirement
   My lean: `is_active=false` with a `notes` explanation. Auditability > minimalism.
4. **Migration strategy** — new column `has_pre_ingest_allowlist` starts false for all. Population pass populates news-google to true. Or: NULL default and treat NULL as false. My lean: NOT NULL DEFAULT false (simplicity).

---

## 7. Relationship to WO-DATA-INTEGRITY's `sources` table

There is already a `sources` table read by the existing `staleSources` probe at `system-watchdog:1059`. It stores per-source `last_ingested_at` for a different, narrower set of sources (mostly RSS feeds). **We do NOT replace it** — that table is per-source-URL (multiple rows per producer function). The new `source_health_registry` is per-producer-function. They coexist:
- `sources`: individual RSS feed / URL / API endpoint went stale → maintenance surface for the source list
- `source_health_registry`: the producer function itself is under/over/silent → maintenance surface for the code + config

The existing `staleSources` probe is left alone. New probes read from `source_health_registry`.
