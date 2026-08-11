# WO-WRAITH-VULN-SCAN-DEAD-01 — the security vulnerability scanner has never run

**Logged:** 2026-08-02. **Status: CLOSED 2026-08-11** — scanner revived (322 findings, 9/9 nightly) + registered + heartbeated; acceptance run and passed. Scale/precision -> WO-WRAITH-SCOPE-01. **Priority:** P1 (the platform's own vulnerability scanner is dead; a security control that has never produced output). Surfaced via WO-REVERSE-PHANTOM-PROBE-01.

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

---

## FIX ATTEMPT 2026-08-02 — layer 1 fixed, layer 2 exposed, STILL NOT WORKING

**Layer 1 (URL) — FIXED.** Root cause confirmed: the scheduled `net.http_post` URL literal was split across a line with injected whitespace (`.../wraith-secur\n  ity-advisor`). Rescheduled with a clean single-line URL — migration `20260802150000_fix_wraith_vuln_scan_cron_url.sql`. The request now reaches the function.

**Layer 2 (auth) — EXPOSED, BLOCKS THE SCAN.** Manual invoke (pg_net → `run_vulnerability_scan`) returned **HTTP 401 `{"error":"Authentication required"}`**. The gate accepts service-role only when the Bearer equals env `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_JWT`; the cron sends `current_setting('app.settings.service_role_key')`, which does **not** match — the documented **task #111 wraith env-var key drift** (CLAUDE.md). The snapshot cron uses the same key but succeeds only because `wraith-snapshot-codebase` has **no auth gate**; `wraith-security-advisor` does. **So even with the URL fixed, the nightly scan still produces zero findings.**
→ **NOT calling it fixed.** Layer 2 is an auth-alignment decision (align `app.settings.service_role_key` to the gate's env key, OR widen the gate) — **credential-adjacent, HELD for operator go** (no service-role secret changes without explicit confirmation).

## SCOPE — 5 files, a sample not a scan (point 2)
`scanTargets` is hardcoded to **5 files**: `ingest-signal`, `ai-decision-engine`, `correlate-entities`, `incident-action`, `_shared/handlers-signals-incidents` (`codebase_snapshots` confirms exactly these 5). Against ~351 deployed functions that is **~1.4% coverage** — a sample, not a scan. **`ai-tools-query` is NOT in `scanTargets`**, so the production scanner **structurally cannot flag `ai-tools-query@adce9554`** — it never reads the file, regardless of exit code.

## Vuln classes (VULN_PROMPT) — correctly aimed, empirically unproven
Opus, per file: (1) SQL/PostgREST injection via unsanitized input, (2) auth bypass / RLS bypass / service-role misuse, (3) prompt injection, (4) SSRF, (5) hardcoded secrets, (6) data exfiltration via logs/errors, (7) chained vulns. Returns JSON with `severity`, `cvss_score`, `cwe_id`. The documented `ai-tools-query@adce9554` vulns — unscoped cross-tenant reads, `.or(\`…ilike.%${query}%\`)` PostgREST filter injection, `verify_jwt=false` — fall under classes **1 + 2**, so the prompt **would target them**. But detection is **unproven**: (a) auth 401 blocks a live run, and (b) the file is out of scope. The prompt looking right is not proof the model flags it.

## Verdict
Still **non-functional**. Two blockers before a single finding: layer-2 auth (task #111) and — for the known-bad specifically — a scope that excludes it (and 346 other functions). Detection capability **unproven**; do not treat as a working control. `agent-sentinel` remains the only *functioning* security probe (posture, not code-vuln).

## OPTION A APPLIED 2026-08-02 — auth FIXED, but detection is BROKEN (deeper finding)
Operator chose Option A (canonical internal gate). Applied + verified:
- **Auth root cause (final):** not key drift — `app.settings.service_role_key` (the GUC the cron read) was **unset**, so the cron sent an empty bearer. The vault `service_role_key` (every other cron's key) **also** 401s against wraith's env-exact gate. No DB-accessible key satisfies it.
- **Fix:** gated the 3 operator-only actions (`run_vulnerability_scan`, `analyze_signal_threat_dna`, `detect_prompt_injection`) on the canonical `checkInternalCaller` (`x-fortress-internal`, constant-time, fail-closed) — used, not forked; returns 404 for indistinguishability. User actions untouched. Cron migration `20260802160000` sends `x-fortress-internal` from vault (mirrors source-discovery). **Blast radius:** the two internal callers were updated to send the header — `dashboard-ai-assistant` (detect_prompt_injection; would have failed **open**) and `job-worker` (analyze_signal_threat_dna via the queue). All deployed.
- **Auth now works:** manual invoke → **HTTP 200**, 5 files scanned. The cron will produce.

**BUT the detection proof FAILED (the important finding):**
- 2a — 5-file scan: **`total_findings: 0`.**
- 2b — injected a verbatim `ai-tools-query@adce9554` excerpt (unscoped cross-tenant reads in `get_recent_signals`/`get_active_incidents` + `ilike` filter injection `.or(\`name.ilike.%${searchQuery}%\`)` in `search_entities`) into scope and scanned: **6 files scanned, `total_findings: 0`.** The scanner flagged **none** of the textbook instances of its own prompt's vuln classes #1 and #2. (Logs confirm the model *was* called — 21.5s execution — so it ran; it just returned/parsed 0.) The excerpt is an *easier* target than a 1000-line file, which makes the result stronger: it cannot flag an obvious injection in 34 lines.
- **Conclusion:** reviving the cron was necessary but insufficient. **The scanner runs and detects nothing — a rubber stamp.** A clean report from it means "found nothing," not "nothing to find." Detection quality is a second, prerequisite fix (root-cause: model under-detection on the current single-shot prompt, or silent parse-drop of findings — needs investigation). Tracked in **WO-WRAITH-SCOPE-01**. `verify_jwt=false` is unscannable — it lives in `config.toml`, not `index.ts`.

## STATUS 2026-08-02: auth FIXED + detection FIXED & PROVEN
Both original blockers closed. Auth = Option A (internal-caller gate). Detection = model route (`openai/gpt-5.2`) + truncation (150 KB) + fail-loud; the adce9554 proof flagged the ilike injection + unscoped reads (28 findings). Remaining work is NOT "is it dead" but **scale + validation** → WO-WRAITH-SCOPE-01 (budget/cursor for full scope — the 6-file full scan hit the 150s ceiling; precision validation; register+heartbeat) and WO-WRAITH-DAILY-DIGEST-01 (coverage-explicit digest). This incident's core defect (dead scanner reporting clean) is resolved.

## Revised fix order
0. **DETECTION — DONE & PROVEN 2026-08-02** (model 404 + truncation + swallowed-error, all fixed; see WO-WRAITH-SCOPE-01 §0). Also generalized into the **Fail-Loud Doctrine** (`architecture-decisions/fail-loud-doctrine.md`).
1. **Auth (task #111):** DONE — Option A applied 2026-08-02.
2. Re-invoke; confirm `wraith_vulnerability_findings` gets ≥1 row (or explicit empty-scan record distinguishable from never-ran).
3. **Prove detection on `ai-tools-query@adce9554`** (temporarily in scope): it must flag the tenant-isolation / filter-injection vulns, or the scanner is a rubber stamp.
4. **Scope:** make `scanTargets` a real inventory (all deployed functions, batched) or risk-ranked — not 5 hardcoded.
5. Register + heartbeat (Registry-is-a-Promise) + a probe that reads `cron.job_run_details` failures (the one signal that showed this).

## CLOSED 2026-08-11 — acceptance RUN and PASSED (points 2 + 5)
Ran the WO's own acceptance criteria (not "the next step is done"):
- **Point 2/4 — findings + cron success (measured):** `wraith_vulnerability_findings` = **322 rows** (was 0 ever), 226 in the last 7d, latest today; `cron.job_run_details` for `wraith-vuln-scan-nightly` = **9 runs, 9 succeeded, 0 failed since 2026-08-02** (was 114 failed / 0 ok for 113 days). The dead scanner is alive and producing nightly.
- **Point 5 — Registry-is-a-Promise (the fix for the 113-day invisibility):**
  - **Registered** in `cron_job_registry` (`wraith-vuln-scan-nightly`, 1440m, critical).
  - **Heartbeat added + PROVEN.** Moved to a **start-heartbeat** (Mode-2): `startHeartbeat` at the top of `runVulnerabilityScan` (visible on invocation even if a run hits the ~150s ceiling — an end-only heartbeat wouldn't write on a killed run), `completeHeartbeat` at the end. Verified live: a triggered run wrote a `running` row within ~1s of invocation, and a completed run wrote `completed` with `{critical, high, total_findings}`. A future failure is now visible (stuck `running` / missing heartbeat), which is precisely the signal whose absence hid this for 113 days.
- The `cron.job_run_details`-failure probe (broader class) remains [[WO-REVERSE-PHANTOM-PROBE-01]]; registration means the standard registry-phantom/Registry-is-a-Promise probes now watch this job.

**This WO's defect — "the security vulnerability scanner has never run / dead scanner reporting clean" — is RESOLVED and proven.** Remaining work is NOT "is it alive" but **scale + precision** (5-file/1.4% scope; ~170s runtime near the ceiling; per-finding validation) → tracked in [[WO-WRAITH-SCOPE-01]], and the coverage-explicit operator digest → [[WO-WRAITH-DAILY-DIGEST-01]]. WO CLOSED.
