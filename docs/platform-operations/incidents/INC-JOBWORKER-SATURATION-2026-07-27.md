# INC-JOBWORKER-SATURATION-2026-07-27

**Status:** CONTAINED (2026-07-27). Root cause understood; permanent fix (job-worker single-flight guard) deferred to a gated build. `job-worker` and `correlate-entities` remain disabled overnight pending that fix.

**Severity:** P1 — prod database connection pool fully exhausted; super-admin UI unusable; operator diagnostics locked out.

**Detection:** Operator report — super-admin page hangs >20s on load, "Loading is stuck" guard firing. NOT caught by the watchdog (the watchdog checks whether functions *run*, not whether they are saturating shared infrastructure).

---

## Root-cause chain

A single undersized-compute + concurrency defect cascaded into a total connection lockout:

1. **Undersized compute (contributing factor).** Prod ran on the **Nano** compute add-on (**0.5 GB shared**) since inception — while the account was **already paying for Micro** (1 GB), a pure misconfiguration with no cost delta. `correlate-entities` loads **all active entities** (thousands, paginated 1000/page) into memory and runs O(entities × names × variants) matching against the full document text. On large inputs (NVD "Vulnerability Summary for the Week of…" HTML tables) this **exceeded the Nano memory ceiling → HTTP 546 `WORKER_RESOURCE_LIMIT`**. Evidence: every recent `status='failed'` `correlate-entities` job carries `HTTP 546: {"code":"WORKER_RESOURCE_LIMIT",...}` with large `payload.text` vulnerability-summary bodies.
2. **No single-flight guard on `job-worker`.** `job-worker` (`supabase/functions/job-worker/index.ts`) is pg_cron-triggered every 60s, claims `BATCH_SIZE=25` jobs per tick, invokes each target with `JOB_TIMEOUT_MS=90_000`, and runs up to `RUN_TIMEOUT_MS=110_000`. Because a run can last 110s while cron re-fires at 60s, **worker runs overlap** — multiple concurrent workers each holding a PostgREST/service-role connection and issuing long UPDATEs against slow/failing targets (`correlate-entities` at 546, etc.). Evidence: `job-worker` edge invocations at 15s / 95s / **152s (504)** durations.
3. **Connection-pool exhaustion → statement-timeout storm.** The overlapping long-held connections saturated the pool; queries were cancelled by `statement_timeout` continuously (~every 40–60s) and a routine checkpoint stretched to **269.7 s** under the I/O/connection pressure. Evidence: repeated `ERROR: canceling statement due to statement timeout` + `checkpoint complete: … total=269.723 s` in postgres logs.
4. **Leaked connections did not self-clear.** Even after `job-worker` was neutralized, the pool stayed 100% locked for >10 min — active queries would have aged out via `statement_timeout` (~8s), so the residual holders were **leaked `idle in transaction` connections**, which `statement_timeout` does not kill. They release only on client disconnect or DB restart.
5. **Total lockout → boot queries killed → UI guard.** New connections could not be acquired from **any** path — MCP `execute_sql`, the Supabase dashboard SQL editor, and anon REST all failed (REST DB round-trips returned **Cloudflare 522 after ~19.5s**). The super-admin view issues the heaviest cross-tenant PostgREST/RPC calls in the app on boot; those hung >20s and tripped the "Loading is stuck" guard — the operator-visible symptom.

### Separate, lower-severity defect surfaced (NOT the saturator)
`process-intelligence-document/index.ts:586` prompts the extraction LLM with an entity-type enum **superset** of the DB `entity_type` enum. DB enum = `person, organization, location, infrastructure, domain, ip_address, email, phone, vehicle, other`. The prompt additionally offers `asset, project, route, research_initiative` (and omits `other`). When the model returns one of the four extras, the `entities` INSERT fails: `ERROR: invalid input value for enum entity_type: "project"` (observed in bursts of 40+). This fails individual `process-intelligence-document` jobs; it is noise + wasted work, not the pool saturator. **Fix deferred — see follow-ups.**

---

## Timeline (UTC where known; log pipeline lagged during the incident, so some steps are session-relative)

- **~17:09–17:12** — Postgres logs show the statement-timeout storm + 269s checkpoint. Edge logs show `job-worker` 500/504/546 at 15–152s and `correlate-entities` 546 bursts. (During the incident the logs API served a **frozen ~8h-stale snapshot**, so real-time log visibility was lost — an operational gap in its own right.)
- **Incident session (2026-07-27)** — Operator reports super-admin hang. Triage confirms static frontend healthy (200, ~0.15s) but REST DB round-trips **522 @ 19.5s**; MCP `execute_sql` and dashboard SQL editor both cannot acquire a connection.
- **Mitigation 1 — `job-worker` kill-switch.** With SQL levers unreachable (pool exhausted → `cron.job` update impossible), the reversible lever available was the management-API deploy path. Deployed a **no-op `job-worker` v60→v61** that returns 200 instantly and opens zero DB connections. Original preserved at `ops/incident/INC-JOBWORKER-SATURATION-2026-07-27/job-worker.original.v60.index.ts`. Verified live: `{"paused":true}` in 0.56s.
- **Re-probe** — still 522; pool not draining → leaked-connection hypothesis.
- **Mitigation 2 — `correlate-entities` disabled.** Set Supabase secret `CORRELATE_ENTITIES_DISABLED=true` (in-code kill-switch at the top of the handler; no deploy). Verified: 503 `{"disabled":true}` in 1.3s, zero DB connections. Re-probe still 522 → confirmed leaked connections require a restart.
- **Resolution — compute resize + restart (operator).** Upgraded compute **Nano → Micro** (already paid for; no cost change) and restarted prod via the resize. This cleared all leaked backends and doubled the memory ceiling that caused the 546s.
- **Recovery verified.** `SELECT 1` via MCP → `[{"ok":1}]`; REST `clients` → **200 @ 0.56s**, `sources` → **200 @ 0.17s** (was 522@19.5s).

---

## `function_jobs` survey (post-recovery, evidence)

The queue's **dead-letter cap works** — every failed `job_type` shows `max_attempts_seen = cap = 3`; jobs fail after exactly 3 attempts and land in `status='failed'`. **The saturation was a runtime-concurrency problem, not queue poisoning.** There is no giant poison backlog.

Notable rows (all-time):
- `correlate-entities` — 7023 completed / **35 failed** (546 resource-limit; newest 2026-07-20) / **26 pending** (created 16:57–16:58 today) / 5 `in_progress` **orphaned** (2026-05-01…05-20 — claimed then never marked; worker died mid-run).
- `process-intelligence-document` — 20680 completed / 19 failed (newest 2026-05-23) / 5 pending today.
- `score-signal-anomaly` — **1881 failed** (historical, newest 2026-06-28) — large but stopped ~a month ago; investigate separately.
- `check-incident-escalation` — 216 failed (newest 2026-07-03).
- 1 `score-signal-anomaly` `in_progress` orphan (2026-05-01).

Sample poison payloads (3 of 6 most-recent failed): all `correlate-entities`, `attempts=3/3`, `HTTP 546 WORKER_RESOURCE_LIMIT`, `payload.text` = "Vulnerability Summary for the Week of …" (large NVD HTML). This is the direct evidence linking the failures to the Nano memory ceiling.

---

## Current state (overnight)

| Component | State |
|---|---|
| Prod DB | ✅ Recovered, `ACTIVE_HEALTHY`, compute now **Micro (1 GB)** |
| `job-worker` | ⛔ **Disabled (v61 no-op)** — stays dead pending single-flight fix. Queue does NOT drain overnight (expected/accepted). |
| `correlate-entities` | ⛔ **Disabled** via `CORRELATE_ENTITIES_DISABLED=true` — belt-and-suspenders; moot while job-worker is dead. |
| RSS / report-gate work | ⏸ Parked (INC pre-empted it) |
| Original job-worker source | Preserved at `ops/incident/INC-JOBWORKER-SATURATION-2026-07-27/job-worker.original.v60.index.ts` |

---

## Standing follow-ups (build items — HELD for ruling, do NOT ship tonight)

1. **`job-worker` single-flight / overlap guard (blocker for re-enable).** Before restoring the original worker, add a guard so a new cron tick cannot start while a run is in flight (advisory lock / `cron_heartbeat` in-progress check / claim-lease). This is the *actual* fix — the DLQ cap already exists; overlap concurrency was the defect. **`job-worker` must not be re-enabled until this ships.**
2. **`correlate-entities` memory footprint.** It loads all active entities into memory each call. Even on Micro this is fragile as the entity table grows. Bound it (server-side candidate filtering / indexed match / chunking) before re-enabling, or keep it behind the flag.
3. **`entity_type` enum drift** (`process-intelligence-document:586`). Reconcile the LLM prompt enum with the DB enum — either add `asset/project/route/research_initiative` to the DB `entity_type` enum, or clamp the prompt to valid values and map extras → `other`. Ruling needed on which direction.
4. **Orphaned `in_progress` jobs** (6 rows, 2026-05). Hygiene: reap `in_progress` older than a threshold back to `pending`/`failed`. Low priority.
5. **`score-signal-anomaly` 1881 historical failures** — investigate separately; not part of this incident.
6. **Compute right-sizing** — Micro is the paid tier; confirm it is sufficient and add a compute/memory alarm. The watchdog should gain a **shared-infra saturation** check (connection count / statement-timeout rate), since it missed this class entirely.
7. **Logs pipeline lag** — the logs API served an ~8h-stale snapshot during the incident, blinding real-time diagnosis. Note for observability follow-up.

## Detection/response lessons
- **The specified reversible levers (disable cron / park jobs via SQL) were unreachable *because of* the incident** — the pool exhaustion locked out SQL from every path including the dashboard. The working lever was the management-API deploy path (function no-op) + the in-code env kill-switch + compute restart. Record this: **an incident that exhausts the DB can lock out its own SQL-based remediation; keep non-SQL levers (function kill-switches, env flags, compute restart) in the runbook.**
- **`correlate-entities` has an env kill-switch (`CORRELATE_ENTITIES_DISABLED`)**; `job-worker` did not — hence the deploy-based no-op. Consider standardizing an env kill-switch on every heavy/queue-draining function.
