# Mission Success Watchdog Assessment

**Operator-directed 2026-05-31 (Task #133).** Read-only diagnosis of workflows that can report healthy while failing their operational objective. No implementation.

The problem class is hypothesis-confirmed: `agent-action-auto-approve-hourly` ran **87 times in the last 7 days, every single run returning `{approved_count: 0}`**. 87 green heartbeats. 87 mission failures. Current monitoring shows the job is healthy.

---

## §0 — The Pattern

> A workflow can succeed at execution while failing its purpose.

Heartbeat metrics answer *did the function fire?* Mission metrics answer *did the function accomplish anything?* Most Fortress monitoring conflates them.

**Three failure shapes that look healthy:**

| Shape | Example |
|---|---|
| **Empty success** — job runs, returns 0/null, writes succeeded heartbeat | `auto_approve_safe_actions` returning `{approved_count: 0}` × 87 |
| **Wrong-target success** — job runs against a target that doesn't include the real data | `auto_approve_safe_actions` INNER JOIN excluding NULL-context actions |
| **Missing job** — work that should be done but no job exists for | `monitoring_proposals` expiry (126 stale rows; no cron) |

The first two register in heartbeat as success. The third doesn't register at all (no job = no missing-heartbeat alarm).

---

## §1 — The Inventory Table

Each row: a workflow whose mission can fail silently under current monitoring.

| # | Workflow | Heartbeat metric (today) | Mission metric (today) | Silent failure possible? | Current detection? | Recommended detection |
|---|---|---|---|:-:|---|---|
| 1 | **`auto_approve_safe_actions` (cron hourly)** | `status='succeeded'` + duration | result_summary `{approved_count}` — written but unread | **YES — PROVEN** (87/87 = 0 approved last 7d) | NONE | Watchdog: `approved_count = 0` for N consecutive runs while `awaiting_approval` count > 0 → flag |
| 2 | **`monitoring_proposals` expiry job** | DOES NOT EXIST | DOES NOT EXIST | YES — failure of omission (126 stale rows) | NONE — missing job is invisible | Watchdog: count rows where `status='pending' AND expires_at < NOW()`; flag if > 0 |
| 3 | **`entity_suggestions` match-existing auto-resolve** | DOES NOT EXIST | DOES NOT EXIST | YES — 107 pending rows match existing entities | NONE | Watchdog: count rows where `status='pending'` AND `EXISTS (SELECT 1 FROM entities WHERE name=…)`; flag if > 0 |
| 4 | **`entity_suggestions` in-queue dedup** | DOES NOT EXIST | DOES NOT EXIST | YES — 124 pending exact-dupes | NONE | Watchdog: count duplicate groups in pending; flag if any > 1 |
| 5 | **QR1 dedup gate (monitoring_proposals_dedup_idx)** | `function_telemetry.context->>'event'='qr1_dedup_blocked'` (NEW per Task #130) | same | YES — until Task #130 telemetry was added, no SQL-queryable proof | Partial (after Task #130 deploys) | Watchdog: weekly report of `qr1_dedup_blocked` count vs `monitoring_proposals` inflow; flag if inflow grows but block count = 0 |
| 6 | **`generate-monitoring-proposals` (CRUCIBLE batch)** | `status='succeeded'` per run | none — function returns `totalProposals` count to caller; not persisted in queryable form | YES — CRUCIBLE could degrade prompt-side and produce 0 proposals; would still register heartbeat | NONE | recordTelemetry with `proposals_created` count; flag if 0 across rolling window when inflow expected |
| 7 | **`generate-daily-briefing` (cron daily)** | `cron_heartbeat` succeeded | `briefing.html` is generated in scheduled_briefings (?) — current verification unknown | YES — briefing could be empty/error in body but HTTP 200; cron sees success | Behavioral health phase in watchdog checks "agent enrichment coverage" only; not briefing-body health | Watchdog: assert briefing HTML > N chars + contains required sections; flag empty body |
| 8 | **`send-daily-briefing` (cron 13:00 UTC)** | `cron_heartbeat` succeeded; avg duration 69 seconds | did the email actually deliver to operator inbox? — no current check | YES — Resend API could 5xx silently; cron returns success if surrounding code didn't throw | NONE (no read-receipt check) | Watchdog: check Resend message-status API for delivery; flag any non-delivered |
| 9 | **`monitor-news-google-hourly`** | `cron_heartbeat` succeeded + duration; result_summary includes counts | signals created? CLAUDE.md says social monitors are checked for "3+ runs with 0 signals" — but NOT news monitors | YES — Task #100 already proved this (Track G allowlist + empty tenant overlay = zero yield while heartbeat green) | PARTIAL — social-monitor-only behavioral check; news monitors not covered | Watchdog: per-monitor signals_created count; flag any monitor with 3+ consecutive zero-yield runs |
| 10 | **`monitor-instagram-2h`** | `cron_heartbeat` succeeded; avg dur 77s | signals_created (zero for the lifetime of the function per Task #10) | YES — function exists, runs, but has never produced a signal | YES — behavioral health phase (CLAUDE.md "Social monitor signal yield") detects this | Already covered |
| 11 | **`monitor-darkweb-6h`** | `cron_heartbeat` succeeded; avg dur 25s | signals_created | YES — darkweb has zero baseline signal volume but covered by social-monitor-only watchdog rule | UNCLEAR — depends if "social monitor" classification includes darkweb in the watchdog rule | Watchdog: extend social-monitor-yield-check to ALL monitor-* functions |
| 12 | **`monitor-github-6h`** | currently status='running' on 14 invocations (never marked succeeded) | n/a — never completes | YES — stuck-running state; cron continues firing, function never returns | NONE — duration_ms NULL means the watchdog can't see the stuck state via avg-duration alarms | Watchdog: flag any job with `status='running' AND started_at < NOW() - INTERVAL '2× expected_interval'` |
| 13 | **`knowledge-synthesizer-nightly`** | 3 stuck-running invocations | same as #12 | YES — same stuck-running pattern | NONE | Same fix as #12 |
| 14 | **`ingest-signal`** | not on cron; called from monitors | rows in `signals` table | YES — signal could be quarantined silently; current quarantine isn't operator-visible | PARTIAL — quality_status='quarantined' tracked but reasons not aggregated | Watchdog: distribution of quarantine reasons over 24h; flag spike or new reason |
| 15 | **Incident promotion (signal → incident)** | no cron; user-driven or agent-triggered | rows in `incidents` table | YES — promotion rules could change; no signal-to-incident pipeline metric today | NONE | Watchdog: weekly ratio of high-severity signals to created incidents; flag if signals trend up but incidents flat |
| 16 | **`alert-delivery` (cron every 15 min)** | `cron_heartbeat` succeeded | `alerts.dispatched_at` populated? | YES — alert could be created, alert-delivery could "succeed" without actually firing the channel | UNCLEAR — depends on whether watchdog reads alerts.dispatched_at | Watchdog: count alerts with `dispatched_at IS NULL` older than 1 hour; flag if > 0 |
| 17 | **`auto-enrich-entities-nightly`** | `cron_heartbeat` succeeded | rows updated in `entity_suggestions` (writes via `matched_entity_id=entity.id`) | YES — function could produce zero enrichments while green | NONE | Watchdog: track enrichment-row count per run; flag if 0 across N runs |
| 18 | **`system-watchdog-daily` (META)** | `cron_heartbeat` succeeded; avg dur 125 seconds | findings written to `platform_findings` | YES — watchdog itself could pass green while missing the missing-coverage list (e.g., everything in this table) | Watchdog watches itself only via heartbeat | Manual: periodic audit of watchdog scope vs the catalog of mission risks (this assessment is one) |

---

## §2 — Categorical Pattern Analysis

The 18 workflows above fall into five silent-failure categories:

### Category A — Empty-success approval/maintenance (#1, #17)

Job runs, succeeds, processes zero candidates. Heartbeat green. Mission failed.

**Common cause:** join/filter predicate excludes the real data shape.
**Fix shape:** read `result_summary` and alarm on persistent-zero counts.

### Category B — Missing jobs (#2, #3, #4)

The job that would do the work doesn't exist. There's no heartbeat to be green. The gap is invisible.

**Common cause:** schema designed for automation; cron never wired.
**Fix shape:** watchdog queries for "schema-implies-job" conditions (e.g., expires_at past NOW but status still pending) and flags the absence.

### Category C — Stuck-running (#12, #13)

Function invocation begins but never completes. `cron_heartbeat` row stays in `running` indefinitely. Cron continues firing new invocations; old ones never resolve.

**Common cause:** function hits a non-throwing infinite loop, hangs on external HTTP call, or crashes after `startHeartbeat` but before `completeHeartbeat`.
**Fix shape:** watchdog flags `started_at < NOW() - 2× expected_interval AND status='running'`. Reset to `failed` after timeout.

### Category D — Empty-yield monitor (#9, #11, #14 partial)

Monitor runs, registers heartbeat, but produces zero signals. Already covered for social monitors per CLAUDE.md; **NOT covered for news/court/csis/darkweb/cisa-kev/macro-indicators/canadian/etc.**

**Common cause:** API quota exhausted, source URL changed, query returns nothing, ingestion-gate rejects everything.
**Fix shape:** uniform per-monitor zero-yield detection across ALL `monitor-*` functions, not just social.

### Category E — Pipeline-output silent gap (#7, #8, #15, #16)

Output exists, but no one verifies it reached its consumer or matched its purpose.
- Daily briefing: HTML generated but never opened? Empty body but cron green?
- Send-daily-briefing: email accepted by Resend but bounced silently?
- Incident promotion: signal-to-incident ratio drift?
- Alert delivery: alerts created but dispatched_at never populated?

**Common cause:** the surrounding code returns success regardless of downstream confirmation.
**Fix shape:** watchdog reads the downstream consumer state (delivery receipts, file sizes, ratio drift) and compares against expected behavior.

---

## §3 — What the Watchdog Currently Covers

Per CLAUDE.md "Behavioral health phase" + this audit:

| Coverage | Phase |
|---|---|
| Agent enrichment coverage (≥50% of high-severity signals last 48h have agent_review) | Behavioral health phase |
| Social monitor signal yield (3+ runs with 0 signals → flag) | Behavioral health phase |
| Entity content freshness (active entities not deep-scanned 30+ days) | Behavioral health phase |
| Feedback loop health (feedback exists but learning_profiles stale 48h) | Behavioral health phase |
| Cron heartbeat presence (job missed its window) | Watchdog cron check |
| Cron alignment (cron_job_registry matches actual cron schedule) | Validation script |

**Not covered:**
- Approval-job mission success (Category A)
- Missing-job-for-pending-work detection (Category B)
- Stuck-running jobs (Category C)
- Non-social monitor zero-yield (Category D, partial)
- Pipeline-output verification (Category E)

The watchdog has the *infrastructure pattern* (behavioral health phase, platform_findings persistence, daily cron). What's missing is the catalog of mission-success checks.

---

## §4 — Three Cross-Cutting Watchdog Additions

Not a recommendation; description of shape.

### W-MISSION — A new watchdog phase

Run alongside the existing behavioral health phase. For each registered job in `cron_job_registry`, define a **mission-success predicate** that returns a count. The phase queries `cron_heartbeat.result_summary` over a rolling window and flags:
- Job whose mission-count = 0 for N consecutive runs while preconditions (e.g., inflow exists) are non-zero
- Job stuck in `status='running'` for > 2× expected interval

### W-COVERAGE — A new watchdog phase

For each known maintenance gap (schema-implies-job pattern), assert the gap doesn't exist:
- No `monitoring_proposals` rows with `status='pending' AND expires_at < NOW()`
- No `entity_suggestions` rows with `status='pending'` matching an existing entity
- No `entity_suggestions` rows duplicating each other within pending
- No `alerts` rows where `dispatched_at IS NULL` older than 1 hour
- No `monitoring_proposals_dedup_idx` 23505 events absent while inflow is normal

This is the "queue cannot self-maintain" doctrine made testable.

### W-PIPELINE — A new watchdog phase

For each operator-visible output pipeline, assert downstream confirmation:
- daily briefing HTML > 500 chars
- send-daily-briefing → Resend delivery confirmed
- signal-to-incident promotion ratio within normal range
- generate-monitoring-proposals → proposals_created > 0 when inflow was non-zero

---

## §5 — The Exemplar Made Concrete

The Watchdog's job is to read the same data the operator would, with the same skepticism.

**Today's failure mode:**
- `agent-action-auto-approve-hourly` heartbeats green 87 times
- Each `result_summary` says `{approved_count: 0}`
- Watchdog reads heartbeat status, sees `succeeded`, marks the job healthy
- Watchdog never reads `result_summary.approved_count`
- Operator sees no alert; mission failure invisible

**Tomorrow's pattern (W-MISSION):**
```sql
-- Pseudo-code for the watchdog query
SELECT job_name,
       COUNT(*) AS recent_runs,
       SUM((result_summary->>'approved_count')::int) AS sum_mission_count
FROM cron_heartbeat
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY job_name
HAVING SUM((result_summary->>'approved_count')::int) = 0
   AND COUNT(*) >= 6;  -- N consecutive runs
```

Result: a finding row in `platform_findings` saying "agent-action-auto-approve-hourly approved zero items across 87 runs in the last 7 days, while 23 actions sit awaiting_approval. Heartbeat is green; mission is failed."

The data is already there. The check isn't.

---

## §6 — Tie to Doctrine

| Doctrine | How this assessment honors it |
|---|---|
| Measurability is part of the feature | A workflow without a mission-success metric is incomplete by ratification (Task #129/130) |
| Maintenance debt is operational risk | Workflows in Category B (missing jobs) are the textbook case; W-COVERAGE makes them detectable |
| Confidence is not correctness | Heartbeat success is self-reported certainty; mission success is observable outcome; they're different |
| Address generation before approval | Where applicable (W-COVERAGE catches "items shouldn't exist") |
| Measure before and after every intervention | Future interventions need a mission-metric baseline (this assessment IS the baseline) |
| In peace time, improve your fighting position | Watchdog enrichment is the highest-leverage peacetime work — every future feature inherits the new gate |

---

## §7 — Constraints Honored

- No implementation
- No QR3, EX-1, or Campaign 1 work begun
- QR1 observation continues on schedule
- Diagnosis only

The findings here describe the gap. The fix (any of W-MISSION, W-COVERAGE, W-PIPELINE) is operator-decision-gated.

---

## §8 — Most Operationally Relevant Finding

**Of all 18 workflows in §1, the single most actionable is #1:** `auto_approve_safe_actions` has 87 consecutive green-but-empty runs. A single watchdog query against `cron_heartbeat.result_summary->>'approved_count'` would have surfaced this immediately on day 2.

The fix to the *function itself* (broken INNER JOIN, missing context_signal_id) is documented in Task #132 §5. The fix to the *watchdog* (read mission metrics, not just heartbeat status) is the meta-pattern this assessment recommends.

Without the watchdog fix, the next silent failure of this shape will be invisible too.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
