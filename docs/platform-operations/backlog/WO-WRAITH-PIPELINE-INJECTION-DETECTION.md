# WO-WRAITH-PIPELINE-INJECTION-DETECTION — adversarial detection on the pipeline write path

**Logged:** 2026-08-02 (apex-audit ruling, P2 WRAITH half). **Status:** SCOPE — do not build yet. **Owner:** WRAITH (behavioral/adversarial), distinct from agent-sentinel (deterministic config invariants, already shipped as Probe 2f).

## Rationale (record in KB)
**Watchdog (agent-sentinel) proves the door is shut. WRAITH detects whether anyone came through.** Closing the 5 mis-scoped INSERT policies does not tell us what happened during the window they were open, and the next misconfiguration will be caught by watchdog only *after* it exists. WRAITH is the behavioral backstop.

The 2026-08-02 forensic pass on the 5 formerly-anon-writable tables (monitoring_proposals, signal_updates, edge_function_errors, briefing_sessions, itinerary_scan_history) found **no evidence of injection** (all rows attributable to known service-role writers; 0 orphan/null FKs; no injection-burst day). But attribution is *self-reported* — an attacker could set `proposed_by_agent='CRUCIBLE'`. WRAITH is what would catch that.

## Items
### 7 — Unattributed pipeline writes = candidate injection
For rows in `monitoring_proposals` / `signal_updates` / `briefing_sessions` / `itinerary_scan_history` / `edge_function_errors`: flag any row with **no correlating edge-function invocation or service-role fingerprint** in the window around its `created_at`. A legitimate write leaves a trace (an edge-function invocation, a job-worker lease, a cron heartbeat); an anon injection leaves none. Correlate row timestamp + claimed writer against `edge_function_errors`/invocation logs / `cron_heartbeat` / job records. Unattributable write → candidate injection.

### 8 — Provenance-less pipeline rows
Flag pipeline rows lacking **traceable provenance to a known source** (source_url resolvable to a registered source, content_hash present, source_name in the known-source set). **Ties to the existing WRAITH item on signal source-URL verification** — same provenance spine, extended to the write-path tables.

### 9 — Route detections into the injection log → source-credibility feedback loop
Any detection from 7 or 8 → **injection log** → **source-credibility feedback loop**. That connection is already on the WRAITH backlog; unattributed/injected writes are its **highest-value input** (a confirmed injection should tank the credibility of whatever source/path admitted it). Close the loop: detection → log → credibility adjustment → tighter admission.

## Dependencies
- Needs the injection-log substrate + the source-credibility feedback loop (existing WRAITH backlog).
- The write-path tables now deny anon (P0 fix live 2026-08-02) — so items 7/8 are forward-looking detection for the *next* window, plus a one-time retro sweep of the historical open window (Feb 2026 → 2026-08-02) with the self-reported-attribution caveat in mind.
