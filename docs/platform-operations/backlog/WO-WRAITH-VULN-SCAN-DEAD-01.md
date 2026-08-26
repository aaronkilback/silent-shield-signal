# WO-WRAITH-VULN-SCAN-DEAD-01 — the security vulnerability scanner has never run

**Logged:** 2026-08-02. **Status:** SCOPE — bug confirmed, fix HELD for operator. **Priority:** P1 (the platform's own vulnerability scanner is dead; a security control that has never produced output). Surfaced via WO-REVERSE-PHANTOM-PROBE-01.

## The finding
`wraith-vuln-scan-nightly` (cron) → `wraith-security-advisor` (writes `wraith_vulnerability_findings`).
- **Every run has failed. 114 runs, 0 successes, since 2026-04-11** (`cron.job_run_details`: `ok_all=0`, `failed_all=114`, `last_ok=null`, last run 2026-08-02 06:00). **~113 days.**
- **`wraith_vulnerability_findings` = 0 rows, ever** (`total=0`, `latest=null`). The vulnerability scanner has **never produced a single finding.**
- Failure is at the **pg_cron level, not the function**: `ERROR: URL using bad/illegal format or missing URL … SQL statement "insert into n[et…]"`. The scheduled `net.http_post(...)` has a malformed/missing URL, so `wraith-security-advisor` is **never invoked by this cron** — which is why `edge_function_errors` shows nothing for it (the failure is below the function; the function never runs).

## Why it stayed invisible for ~113 days
The classic blind spot (WO-REVERSE-PHANTOM-PROBE-01): **no `cron_job_registry` entry + no heartbeat.** The phantom probe had no registry row to check; the watchdog had no heartbeat to inspect. The one place the failure IS visible — `cron.job_run_details.status='failed'` — is not read by any probe. A security control failed every night for four months and nothing was watching the one signal that showed it.

## Collateral: the snapshotter feeds a dead scanner
`wraith-snapshot-codebase-nightly` **works** — `codebase_snapshots` is current (5 rows, latest 2026-08-02 05:45). But its only consumer is the dead vuln-scan. So the platform faithfully snapshots its own source code every night into a table that **nothing analyzes**. Snapshot without scan = inert data collection.

## Note on scope of the outage
`wraith-security-advisor` is also invoked on other paths (per-signal threat scoring → `wraith_signal_threat_scores`; per-action advice), so *those* wraith capabilities may function. What is dead is specifically the **nightly codebase vulnerability scan** — the proactive "find vulns in our own platform" control. `agent-sentinel` (separate, healthy — daily posture probe) covers RLS/anon-exposure posture but is **not** a code-vulnerability scanner; it does not substitute.

## Fix (when authorized — do not build)
1. **Root-cause the malformed URL** in the `cron.schedule('wraith-vuln-scan-nightly', …)` migration (likely an empty/interpolated project ref or missing `/functions/v1/` base). Repair the `net.http_post` URL; confirm one manual run reaches the function and writes ≥1 row (or a clean "0 vulns" result that is *distinguishable* from "never ran").
2. **Register + heartbeat** it (Registry-is-a-Promise) so a future failure is visible.
3. Decide whether `codebase_snapshots` growth should gate on the scan being alive (don't snapshot into a void).
4. Confirm via measured post-condition: `wraith_vulnerability_findings` receives a row (or an explicit empty-scan record), and `cron.job_run_details` shows `succeeded` — not a 200-that-did-nothing.
