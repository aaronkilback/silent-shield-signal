# WO-REVERSE-PHANTOM-PROBE-01 — count the running-but-unregistered crons

**Logged:** 2026-08-02. **Status:** SCOPE (probe design) + triage done. **Priority:** HIGH.

## Framing
`registry_phantom_check()` and the Registry-is-a-Promise probe start **from the registry**: they verify that every registered promise is kept (has a live cron + a successful heartbeat). They can only ever find **registered-but-not-running** (the 31-phantom count). They **never verify that every runner made a promise.** The inverse — **running-but-not-registered** — is uncounted by any probe. `source-health-manager-4h` ran broken for **~1,490 invocations across ~8 months** (and `wraith-vuln-scan-nightly` failed **114/114 runs across ~113 days**) inside exactly this blind spot: no registry row → phantom probe can't see it; no heartbeat → watchdog can't see it.

## The probe (design — pairs with a heartbeat-coverage check)
1. **Unregistered-runner probe:** `cron.job` **LEFT JOIN** `cron_job_registry` (by jobname, and by the function slug parsed from `command`). Any **active cron with no registry row = an unregistered runner.** Emit **ONE aggregated finding** listing all N (attention doctrine — never one-per-job).
2. **Heartbeat-coverage check (companion):** any active function-invoking cron whose function emits **no `cron_heartbeat`** under a matching name → included in (or a sibling of) the same finding. Dispatch ≠ work: `cron.job_run_details.status='succeeded'` only means the `net.http_post` was *queued*, not that the function ran or produced anything (proven below — jobs dispatching hundreds of times while their output tables stay empty).
3. Exempt SQL-only maintenance crons (no function call) via an allowlist, or register them too.

## Measured state (2026-08-02)
Of **~77 active cron jobs**: **~51 registered · 26 not.** Of the 26 unregistered, **20 invoke edge functions with no heartbeat either** (fully invisible) + 4 are SQL-maintenance + 2 (`system-watchdog-daily`, `send-daily-briefing-13utc`) at least emit a heartbeat.

**The punchline the probe would surface:** the blind spot doesn't hide one broken job — it hides roughly **a third of the jobs in it**. Of the 20 invisible function-crons, at least **6 are confirmed not doing their job** while dispatching cleanly (see triage).

## Triage of the 20 (last dispatch · observable output 7d · classification)
`cron.job_run_details` for dispatch; each function's actual output table for work. "succeeded" below = cron dispatched; **output** column is the real test.

### Priority set (by consequence if silently broken)
| job (function) | last dispatch | 7d dispatch | observable output (7d) | classification |
|---|---|---|---|---|
| **operator-alert-bridge-15min** (alert-operator-bridge) | 08-02 13:39 | 672 ok | **watermark STATIC since 2026-07-08 (25d)** — either genuinely quiet or silently not-delivering; can't tell | **should-register + PROBE** — high consequence, health *unconfirmed* |
| **autonomous-threat-scan-30min** | 08-02 13:25 | 335 ok | `autonomous_scan_results` **+649/7d** ✓ | **should-register** (healthy) |
| **data-quality-monitor-6h** | 08-02 12:15 | 28 ok | **persists NOTHING** (0 inserts/rpc/findings) — output goes only to the discarded HTTP response | **stale-like** — unobservable by construction; needs output-persistence + register |
| **embed-signals-30min** (generate-embeddings) | 08-02 13:31 | 336 ok | **`global_chunks` = 0** (its documented target is empty); signals embed via `signals.content_embedding` (unverified) | **should-register + VERIFY** — global-doc embed path appears dead |
| **generate-daily-briefing-0700** | 08-02 07:00 | 7 ok | **persists nothing / no send**; `send-daily-briefing-13utc` (heartbeated) does the real delivery | **likely-redundant** — deregister or confirm consumer |
| **wraith-vuln-scan-nightly** (wraith-security-advisor) | 08-02 06:00 **FAILED** | **0/7 ok** | **`wraith_vulnerability_findings` = 0, EVER** (114/114 fails since 2026-04-11) | **BROKEN** → WO-WRAITH-VULN-SCAN-DEAD-01 |
| **wraith-snapshot-codebase-nightly** | 08-02 05:45 | 7 ok | `codebase_snapshots` current (5, latest today) ✓ **but feeds only the dead vuln-scan** | **should-register** — value nullified downstream until the scan is fixed |

### Remainder
| job (function) | 7d dispatch | note | classification |
|---|---|---|---|
| source-health-manager-4h | 42 ok | broken query, heals 0 (WO-SOURCE-HEALTH-MANAGER-BROKEN-01) | **stale-like** |
| extract-predicted-events-6h | 28 ok | `agent_world_predictions` = 0 — produces nothing | **stale-like / no-op** (prediction loop unpopulated at source) |
| aggregate-global-learnings-daily | 7 ok | global-learning stores **frozen** (INC-LEARN-CONTAM) | **quiet-by-containment** — verify no-op is by-design |
| auto-orchestrator-5min | 335 ok | orchestration/enqueue — effect unverified | should-register + verify |
| autonomous-operations-loop-15min | 336 ok | unverified | should-register + verify |
| agent-activity-scanner-15min | 336 ok | unverified | should-register + verify |
| aggregate-implicit-feedback-2h | 84 ok | unverified | should-register + verify |
| predictive-scorer-2h (predictive-incident-scorer) | 84 ok | unverified | should-register + verify |
| synthesize-entity-narratives-6h | 28 ok | unverified | should-register + verify |
| process-pending-docs-10min | 504 ok | unverified | should-register + verify |
| audit-knowledge-freshness-weekly | 1 ok | unverified | should-register + verify |
| sync-buzzsprout-daily | 7 ok | external podcast sync, low consequence | fire-and-forget |
| fortress-chaos-weekly | 1 ok | chaos testing | deliberately fire-and-forget |

**"unverified" is the point:** for these I confirmed dispatch but not output. The probe exists precisely so "dispatch ≠ work" gets checked continuously instead of during a one-off audit like this.

## Build order (when authorized)
1. Reverse-phantom probe RPC + watchdog finding (aggregated, one per run).
2. Heartbeat-coverage companion (dispatch-vs-work).
3. Re-triage: register the should-registers (+ add heartbeats); deregister redundant (generate-daily-briefing 0700?); fix/retire the stale (health-manager, wraith-vuln-scan, extract-predicted-events, data-quality-monitor output).
