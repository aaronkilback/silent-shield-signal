# W-MISSION Phase 1 — Exact Trigger Thresholds

**Operator-directed 2026-05-31 (Task #135).** Threshold definitions only. No implementation.

Operator re-ordering accepted: **P1.3 elevated ahead of P1.2** (active stuck-running invocations = real-time evidence vs Task #100's historical proof). New order: P1.1 → P1.3 → P1.2 → P1.4 → P1.5.

---

## §0 — Threshold Calibration Methodology

Each threshold is grounded in empirical data from prod (last 14 days). Three goals:

1. **No false-positive flood** — thresholds must not alarm during normal idle periods
2. **No silent-failure pass-through** — must catch the proven failure modes (87/87 auto-approve, Task #100 news collapse, current stuck-running)
3. **Anchored in data already captured** — Phase 1 cannot require new schema or new columns

Each check defines:
- **Trigger** — the SQL predicate that fires the finding
- **Precondition** — when the trigger is valid (avoids alarming on legitimate idle)
- **Severity** — `warning` / `high` / `critical` (matches `platform_findings.severity` enum)
- **Fingerprint** — used by the existing watchdog auto-dedup mechanism (`platform_findings.fingerprint`); ensures one finding per anomaly window, not N findings per N watchdog runs

Recommended runtime: same daily watchdog cadence (`system-watchdog-daily` at 13:00 UTC). If sub-daily becomes needed later, that's Phase 2 work.

---

## §1 — P1.1 Empty Approval Detector

**Workflow:** `auto_approve_safe_actions` (cron `agent-action-auto-approve-hourly`)
**Observed failure:** 87/87 runs in last 7 days returned `{approved_count: 0}` while 22 actions sat awaiting approval

### Trigger

```sql
WITH window_24h AS (
  SELECT SUM(COALESCE((result_summary->>'approved_count')::int, 0)) AS total_approved
  FROM cron_heartbeat
  WHERE job_name = 'agent-action-auto-approve-hourly'
    AND started_at > NOW() - INTERVAL '24 hours'
    AND status = 'succeeded'
),
eligible_pending AS (
  SELECT COUNT(*) AS n
  FROM agent_actions
  WHERE status = 'awaiting_approval'
    AND created_at < NOW() - INTERVAL '24 hours'
    AND action_type IN ('propose_severity_correction', 'flag_false_positive', 'dismiss_signal')
)
SELECT
  CASE
    WHEN window_24h.total_approved = 0 AND eligible_pending.n > 0 THEN true
    ELSE false
  END AS fire
FROM window_24h CROSS JOIN eligible_pending;
```

### Threshold rationale

- **24h rolling window** (≈ 24 hourly runs): matches function's own `interval '24 hours'` eligibility filter; if no approvals across that window AND eligible candidates exist, the function is definitively broken
- **Precondition `eligible_pending.n > 0`**: avoids alarming during natural idle when no eligible actions exist
- **`action_type` filter**: matches exactly the three types the function handles (per code read in Task #132)

### Severity

| Condition | Severity |
|---|---|
| 24h zero with eligible candidates | `warning` |
| 48h zero with eligible candidates | `high` |
| 7d zero with eligible candidates (current state) | `critical` |

### Fingerprint

`mission:auto_approve_safe_actions:zero_24h`

(single finding refreshes; resolves when sum > 0)

---

## §2 — P1.3 Stuck-Running Detector  **[ELEVATED]**

**Workflow:** any cron-heartbeat-tracked job
**Observed failure:** 14 stuck-running `monitor-github-6h` + 3 stuck-running `knowledge-synthesizer-nightly` invocations

### Empirical baseline (last 7 days, p95 duration)

| Job | p95 duration | Stuck-running threshold (10× p95 floor) |
|---|---:|---:|
| monitor-news-google | 121s | well under 10 min |
| monitor-rss-sources | 105s | well under 10 min |
| monitor-wildfires | 84s | well under 10 min |
| monitor-instagram | 81s | well under 10 min |
| knowledge-synthesizer | 70s | well under 10 min |
| monitor-social-unified | 53s | well under 10 min |
| All other jobs | <50s | well under 10 min |

**Max observed: 178s** (a single monitor-rss-sources outlier near the 180s Supabase SIGKILL ceiling).

### Trigger

```sql
SELECT
  job_name,
  id AS heartbeat_id,
  started_at,
  EXTRACT(EPOCH FROM (NOW() - started_at))/60 AS minutes_stuck
FROM cron_heartbeat
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '10 minutes';
```

### Threshold rationale

- **10 minutes**: 3.3× the slowest observed p95 (121s); ~6× the Supabase SIGKILL ceiling (150s). A heartbeat row stuck in `'running'` for >10 min means the function was SIGKILLed without writing completion OR is genuinely hung
- **Per-row firing**: each stuck heartbeat row generates a finding; the operator sees count + which job

### Severity

| Condition | Severity |
|---|---|
| Single stuck-running row | `warning` |
| 3+ stuck-running rows for same `job_name` in last 24h | `high` |
| 5+ stuck-running rows for same `job_name` in last 7 days | `critical` (systemic, like current monitor-github) |

### Fingerprint

`mission:stuck_running:<job_name>:<truncated_date>`

(daily granularity; same job stuck on different days = distinct findings)

### Auto-resolve

When the affected heartbeat row transitions to `status='succeeded'` or `status='failed'`, the finding auto-resolves on the next watchdog pass.

### Bonus: also flag jobs with persistent stuck pattern

```sql
SELECT job_name, COUNT(*) AS stuck_count
FROM cron_heartbeat
WHERE status = 'running'
  AND started_at > NOW() - INTERVAL '7 days'
  AND started_at < NOW() - INTERVAL '10 minutes'
GROUP BY job_name
HAVING COUNT(*) >= 3;
```

This identifies the systemic case (monitor-github-6h with 14 stuck) separately from one-off stalls.

---

## §3 — P1.2 Zero-Yield News Monitor

**Workflow:** `monitor-news-google-hourly`
**Observed failure:** Task #100 (PROD-S Track G allowlist + empty tenant overlay produced zero-yield invisibly)

### Empirical baseline (last ~30 hours)

```
Distribution of signals_created per hourly run (sample n=30):
  0 signals: ~22 runs (73%)
  1 signal:  ~4 runs
  2 signals: ~4 runs
  Total signals in 30-run window: 14
  Mean signals/run: 0.47
```

**Observation:** the function CURRENTLY runs at low yield. 0 signals in any single hour is normal. Consecutive zeros up to 7 hours observed in healthy operation.

### Trigger

```sql
SELECT
  SUM(COALESCE((result_summary->>'signals_created')::int, 0)) AS total_24h,
  COUNT(*) AS runs_24h
FROM cron_heartbeat
WHERE job_name = 'monitor-news-google-hourly'
  AND started_at > NOW() - INTERVAL '24 hours'
  AND status = 'succeeded'
HAVING SUM(COALESCE((result_summary->>'signals_created')::int, 0)) = 0
   AND COUNT(*) >= 12;
```

### Threshold rationale

- **24h total = 0**: under the observed Poisson model (mean 0.47 signals/run, 24 runs), P(0 signals in 24h) ≈ e^(-24×0.47) ≈ 1e-5. Effectively impossible by chance.
- **`COUNT(*) >= 12`**: precondition that the function actually ran most of the window (avoids alarming if the cron itself was disabled or all runs failed)
- **NOT a consecutive-zero-runs threshold**: too noisy given the observed 7-hour natural zero streaks

### Severity

| Condition | Severity |
|---|---|
| 24h zero with ≥12 successful runs | `high` (news pipeline is critical) |
| 48h zero | `critical` |

### Fingerprint

`mission:monitor_news_google:zero_24h`

### Calibration note

This threshold is loose because current yield is already degraded (per memory `project_signal_collapse_news_allowlist`). When the news pipeline is rehabilitated, the threshold can tighten to `12h zero` or `6 consecutive zero-runs`. For Phase 1, conservative is correct.

---

## §4 — P1.4 Undispatched Alerts

**Workflow:** `alert-delivery` (cron every 15 min)
**Observed failure:** none today; this is a pre-emptive gate for the safety pipeline

### Trigger

```sql
SELECT
  COUNT(*) AS undispatched_count,
  MAX(EXTRACT(EPOCH FROM (NOW() - created_at))/60) AS oldest_minutes
FROM public.alerts
WHERE dispatched_at IS NULL
  AND created_at < NOW() - INTERVAL '30 minutes';
```

### Threshold rationale

- **30-minute floor**: alert-delivery cron runs every 15 min; allowing 2× the cron interval as grace. Any alert with NULL dispatched_at older than 30 min has been observed by the cron at least once without dispatching.
- **Single-alert sensitivity**: alerts are HIGH-consequence (per Task #133 §1 #16). One missed alert is a finding.

### Severity

| Condition | Severity |
|---|---|
| 1 undispatched alert older than 30 min | `warning` |
| 3+ undispatched alerts older than 30 min | `high` |
| 10+ undispatched alerts, or oldest > 2h | `critical` |

### Fingerprint

`mission:alert_delivery:undispatched_count`

(single rolling finding; severity updates; auto-resolves when count drops to 0)

---

## §5 — P1.5 Quarantine Rate Spike

**Workflow:** `ingest-signal` quarantine pipeline
**Observed failure:** none in last 7 days; **observed past anomaly** 2026-05-21 to 2026-05-23 (rates 21-26% over 3 days)

### Empirical baseline (last 14 days)

| Date | Total signals | Quarantined | Rate |
|---|---:|---:|---:|
| 2026-05-31 | 3 | 0 | 0% |
| 2026-05-30 | 10 | 0 | 0% |
| 2026-05-29 | 17 | 0 | 0% |
| 2026-05-28 | 22 | 0 | 0% |
| 2026-05-27 | 19 | 0 | 0% |
| 2026-05-26 | 24 | 0 | 0% |
| 2026-05-25 | 31 | 0 | 0% |
| 2026-05-24 | 23 | 0 | 0% |
| **2026-05-23** | **86** | **22** | **25.6%** |
| **2026-05-22** | **40** | **10** | **25.0%** |
| **2026-05-21** | **51** | **11** | **21.6%** |
| 2026-05-20 | 52 | 4 | 7.7% |
| 2026-05-19 | 46 | 3 | 6.5% |
| 2026-05-18 | 33 | 3 | 9.1% |

**Healthy baseline:** 0-10% quarantine.
**Past anomaly:** 21-26% across 3 consecutive days (operator should have known about this; current monitoring did not surface it).

### Trigger

```sql
WITH last_24h AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE quality_status='quarantined') AS quarantined
  FROM public.signals
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
baseline_7d AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE quality_status='quarantined') AS quarantined
  FROM public.signals
  WHERE created_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day'
)
SELECT
  CASE WHEN last_24h.total > 0 THEN (last_24h.quarantined::numeric / last_24h.total) ELSE 0 END AS rate_24h,
  CASE WHEN baseline_7d.total > 0 THEN (baseline_7d.quarantined::numeric / baseline_7d.total) ELSE 0 END AS rate_7d,
  last_24h.total AS sample_size_24h
FROM last_24h CROSS JOIN baseline_7d;
```

Fire on either:
- **Trigger A**: `rate_24h > 0.15 AND sample_size_24h >= 10` (absolute spike floor)
- **Trigger B**: `rate_24h > 3 × rate_7d AND rate_7d > 0.02 AND sample_size_24h >= 10` (relative spike, with min baseline)

### Threshold rationale

- **15% absolute floor**: the 2026-05-21/22/23 anomaly registered at 21-26%; a 15% floor catches that anomaly with ~6 percentage points of buffer
- **3× relative spike with min baseline 2%**: catches lower-absolute spikes from a quiet baseline (e.g., baseline 4% → 24h 13% = 3.25× → fire)
- **Min sample size 10**: avoids alarming on small-volume days where 1-2 quarantines = high apparent rate
- **`baseline_7d` excludes last 24h**: avoids the 24h window pulling the baseline up with itself

### Severity

| Condition | Severity |
|---|---|
| Trigger A with rate ≤ 25% | `warning` |
| Trigger A with rate > 25% | `high` |
| Either trigger with rate > 50% | `critical` |
| Trigger B (relative spike only) | `warning` |

### Fingerprint

`mission:ingest_signal:quarantine_spike:<date>`

(date-granular; auto-resolves the next day if rate returns under threshold)

---

## §6 — Cross-Cutting Threshold Notes

### Findings persistence + dedup

`platform_findings.fingerprint` already implements dedup (Task #133 §3 schema probe). Each check writes a single finding with its fingerprint; subsequent runs UPDATE `last_seen_at` + `occurrence_count` rather than inserting duplicates. The watchdog should already follow this pattern for its behavioral-health phase findings.

### Auto-resolve pattern

Existing watchdog pattern (per CLAUDE.md): findings auto-resolve when they stop appearing in subsequent runs. Phase 1 inherits this — no per-check auto-resolve logic needed.

### Severity escalation across runs

For P1.1 and P1.5, severity can escalate across runs (24h zero → 48h zero → 7d zero). Implementation pattern: write the appropriate severity on each run; the dedup mechanism updates the existing finding's severity in place.

### Recommended runtime

- All five checks run in the **daily watchdog** (`system-watchdog-daily` at 13:00 UTC)
- Time budget added: ~5 SQL queries × <100ms each = negligible (current watchdog runs ~125s)
- No new cron schedule needed

### Sub-daily considerations (deferred to Phase 2)

- **P1.3 stuck-running**: real-time detection of a stalled function would be more valuable than 24h-late. If sub-daily becomes needed, add to `auto-orchestrator-5min` or similar fast-loop, with the same trigger predicate.
- **P1.4 undispatched alerts**: same reasoning. A safety pipeline check fired daily is a 24h-late warning.

Both can be promoted to faster cadence in Phase 2 if Phase 1 results justify it.

---

## §7 — Calibration Plan (If Thresholds Prove Wrong in Production)

| Symptom | Likely cause | Adjustment |
|---|---|---|
| P1.1 fires every day even after fixing the function | Function fix incomplete OR eligibility condition mismatched | Tighten precondition; require explicit minimum-eligible-count > 3 |
| P1.2 fires daily | News pipeline still degraded; threshold too tight | Loosen to 48h-zero |
| P1.3 fires on legitimate long-running jobs | A new job introduced with >10 min legitimate duration | Add per-job override in cron_job_registry; raise to job-specific p95 × 2 |
| P1.4 fires on alert-storm days | High alert volume overwhelms 15-min cron | Scale severity by count; warning at 5, high at 20 |
| P1.5 fires on day-1 of a real threat surge | Threat reality bumped quarantine rate | Cross-reference with signal volume; if 24h volume > 3× baseline, suppress P1.5 |

Each adjustment is a single-line SQL change in the watchdog phase. No schema change.

### Promotion / demotion criteria

- **Severity promotion** (warning → high): if a check fires for 3+ consecutive daily runs without operator action
- **Severity demotion** (high → warning): never — operator decision only

---

## §8 — Phase 1 Summary Table

| # | Check | Trigger | Existing data | Severity range |
|---|---|---|---|---|
| **P1.1** | Empty-approval (`auto_approve_safe_actions`) | 24h `approved_count` SUM = 0 AND eligible candidates exist | `result_summary.approved_count` | warning → critical |
| **P1.3** | Stuck-running detector (elevated) | `status='running' AND started_at < NOW() - 10 min` | `cron_heartbeat.status` | warning → critical |
| **P1.2** | Zero-yield news monitor | 24h `signals_created` SUM = 0 AND `COUNT(*) >= 12` runs | `result_summary.signals_created` | high → critical |
| **P1.4** | Undispatched alerts | `alerts.dispatched_at IS NULL AND created_at < NOW() - 30 min` | `alerts.dispatched_at` | warning → critical |
| **P1.5** | Quarantine spike | 24h rate > 15% OR > 3× 7d baseline | `signals.quality_status` | warning → critical |

All five queries read existing columns. No new schema. No new tables. No new persistence surfaces.

---

## §9 — Constraints Honored

- No implementation
- No QR3 / EX-1 / Campaign 1 work begun
- QR1 observation continues on schedule
- Threshold definition only

The thresholds are ratifiable. Implementation is operator-decision-gated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
