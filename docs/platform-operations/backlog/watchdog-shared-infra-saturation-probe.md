# Backlog: Watchdog shared-infra saturation probe

**Status:** Backlog (logged 2026-07-28, INC-JOBWORKER-SATURATION-2026-07-27 item 5). **Not built today** — captured per operator ruling.

## Why
The system-watchdog checks whether functions are *running* and doing the *right thing* (behavioral health phase). It does **not** watch whether the platform's **shared infrastructure** is being exhausted. INC-JOBWORKER-SATURATION-2026-07-27 — a runaway job-worker holding DB connections until the pool was fully locked out — was **not** caught by the watchdog; it was reported by an operator noticing the super-admin UI hang. By then, prod DB was already unreachable from every path (MCP, dashboard SQL, REST all 522/timeout).

The gap: **no alarm on DB connection-pool pressure or statement-timeout rate.**

## Proposed probe (design sketch — validate before building)
A watchdog phase that, each run, samples cheap shared-infra health signals and alarms on sustained pressure:

- **Connection census** — `pg_stat_activity` grouped by state: alarm if `active + idle-in-transaction` approaches `max_connections` (e.g. >70%) for N consecutive samples, or if `idle in transaction` count is non-trivial (leaked-txn signature — the INC's actual lockout cause).
- **Statement-timeout rate** — count of `canceling statement due to statement timeout` over a window (from `edge_function_errors`/logs or a lightweight counter). A rising rate is the early symptom.
- **Long-running backends** — any client backend with `now() - query_start` beyond a threshold (e.g. >60s) that isn't an expected long job.
- **Checkpoint duration drift** — checkpoints stretching from sub-second to minutes indicate I/O/connection pressure (observed at 269s during the INC).

Alarm tier: this is an **INTERRUPTION**-class signal (prod-degrading, operator must act) — but must be rate-limited so it spends operator attention only on real saturation, not transient spikes (per attention doctrine).

## Design constraints
- The probe itself must be **cheap and connection-light** — it must not add pool pressure, and must degrade gracefully when the DB is *already* saturated (the exact moment it's needed, a heavy query can't run). Consider a tiny fixed-cost query with a short statement_timeout, and treat "probe itself timed out" as its own strong alarm signal.
- Distinguish **expected** heavy load (a legitimate batch) from **runaway** (unbounded growth / leaked idle-in-txn).

## Related
- Incident: `docs/platform-operations/incidents/INC-JOBWORKER-SATURATION-2026-07-27.md` (follow-up #6).
- The single-flight guard (this incident's fix) prevents the *specific* job-worker overlap cause; this probe is the **general** backstop for any future shared-infra saturator.
