# WO-METRIC-PROVENANCE-AUDIT — every displayed Fortress metric: work-derived or proxy? (SCOPE + first pass)

**Ruling 2026-08-04 (operator).** Three-plus instances of the same class now: the `247,832` homepage counter (removed), `autonomous_scan_results` synthetic pulse, the DR heartbeat gap, monitor-news 0-vs-370. **Enumerate every displayed metric on the Fortress UI; for each state whether it derives from the work it claims to represent, or from a proxy. Flag every proxy.** Report only.

**Definitions.** *Work-derived* = the number is written by the same code path that does the work it represents (write coupled to work). *Proxy* = written by a side-channel, a synthetic pulse, a lifetime accumulator shown as current, or a count of "considered" rather than "done." A proxy is not automatically wrong — but it must be **labeled** as what it is.

## First pass — Neural Constellation page (`useConstellationData.ts`, fully traced 2026-08-04)

| Displayed metric | Source | Class | Note |
|---|---|---|---|
| Agent online/idle/**dormant** status | `signal_agent_analyses` (24h) | **WORK-DERIVED** ✅ | honest; reads real reasoning |
| "9/42 ran in 7d" watchdog dormancy | `signal_agent_analyses` (7d) | **WORK-DERIVED** ✅ | honest (but its *ruling* misdiagnoses cause — see DIAG §3b) |
| **Live Activity** panel ("AGENT scanning, N alerts") | `autonomous_scan_results` | **PROXY** 🚩 | synthetic round-robin pulse (`agent-activity-scanner`); WO-SYNTHETIC-ACTIVITY-REMOVAL |
| **"N scans" counter** (`useScanCount`, 24h) | `autonomous_scan_results` | **PROXY** 🚩 | same synthetic source |
| `alerts_generated` per agent | `autonomous_scan_results` | **PROXY (misattributed)** 🚩 | environment-wide severity counts pinned to one agent |
| "N debates" counter | `agent_debate_records` (lifetime `count(*)`) | **PROXY (lifetime-as-current)** 🚩 | lifetime total shown next to 24h figures — mixes horizons |
| "N knowledge" counter | `expert_knowledge` (lifetime) | **PROXY (lifetime-as-current)** 🚩 | lifetime total; also note INC-LEARN-CONTAM freeze |
| Recent escalations (red particles) | `signals` last 1h (severity/conf/incident) | **WORK-DERIVED** ✅ | already fixed away from `totalAlertsGenerated` per its own comment |
| Cron health halos | `cron_heartbeat` + `cron_job_registry` | **WORK-DERIVED** ✅ | but see DR: a writer that writes nothing reads as "never," which is honest |
| Operator devices online | `operator_heartbeats` (5-min) | WORK-DERIVED ✅ | real device heartbeat |
| Knowledge-growth / learning sessions | `agent_learning_sessions`, `expert_knowledge` | mixed | verify against INC-LEARN-CONTAM freeze (stores frozen) |

## First pass — main dashboards (`useGodsEyeData`, `useFortressHealth`) — sources seen, classification TBD in full sweep

Read from: `signals` (×4), `incidents`, `autonomous_scan_results` 🚩 (proxy — appears here too), `autonomous_actions_log`, `expert_knowledge`, `cron_heartbeat`, `agent_accuracy_tracking`, `predictive_incident_scores`, `entities`, `ai_assistant_messages`, `watchdog_learnings`, `implicit_feedback_events`, `signal_clusters`, `auto_escalation_rules`. **`autonomous_scan_results` is consumed on the God's-Eye/health dashboards too** — the synthetic pulse has more than one display surface; the audit must catch all of them.

## Non-LLM API spend is invisible (added 2026-08-05)

`compute-llm-daily-cost-30min` / `llm_daily_cost` track **LLM tokens only** (OpenAI + Gemini). **Google Custom Search, Maps/Geocoding, Vision, and every other non-LLM API spend is invisible to it** — proven by the $300 Google bill sitting next to a tracker showing ~$0 Gemini (DIAG-2026-08-05-google-300-bill.md). Same class as this week's other findings: **a monitor reporting on a narrower scope than its name implies** ("LLM cost" reads as "AI cost," but the real Google spend is CSE). **Audit requirement:** the metric sweep must include *spend* surfaces, not just activity counters — flag every cost/usage display that covers only a subset of billed APIs, and add non-LLM API spend (CSE query volume, Maps calls) to a cost view before "AI/API cost" is presented as complete. Prerequisite substrate: there is currently **no CSE/Maps spend tracking table at all**.

## NAMED ANTI-PATTERN (2026-08-05): "LLM/synthetic value overwriting a persisted measurement before display"

The audit must **find every instance of this shape, not just catalogue proxies.** Shape: **the real value exists and is persisted, then something plausible replaces it at the display layer, and the plausible one is what the operator reads.** It is more dangerous than a plain proxy because the truth is *right there* in the store — the overwrite actively discards it.

**Confirmed instances (this class recurs):**
- **`system-watchdog:4615-4616`** — `platform_findings.severity` is persisted (`:4355`), then an LLM (`callAI(VERIFICATION_PROMPT)`) overwrites `analysis.severity` + `analysis.findings`, and the **email renders the LLM's rewrite** while the panel shows the persisted rows. Same finding, two severities. (WO-WATCHDOG-FINDING-DISCIPLINE rule 5.)
- **`agent-activity-scanner` → `autonomous_scan_results`** — a synthetic round-robin pulse displayed as agent work, overwriting the real-work signal (`signal_agent_analyses`) on the Live Activity panel. (WO-SYNTHETIC-ACTIVITY-REMOVAL.)
- **fleet-dormancy "KNOWN STRATEGIC" mislabel** — a plausible narrative ("capability configured beyond adoption") displayed over the real cause (pipeline break). (DIAG-2026-08-04 §3b.)
- **`247,832` homepage counter** — a fabricated incrementing number displayed as a live measurement (removed 2026-08-03).

**Detection rule for the sweep:** for every displayed number, ask not only "proxy or work-derived?" but **"is there a persisted measurement this display *overwrites or replaces* with a computed/LLM/synthetic value?"** If yes → flag: the display must render the persisted value; any LLM/synthetic layer may add prose or annotation, never replace the measurement. **One measurement, one value, everywhere it appears.**

## Remaining scope (the full sweep — this WO's deliverable)

Every component under `src/components/` + `src/pages/` that renders a number: trace each to its query, classify work-derived vs proxy, flag proxies, and for each proxy decide relabel / repoint / remove. Priority surfaces: God's-Eye dashboard, Fortress health, Learning dashboard, Monitoring diagnostics, any "counter"/"stat"/"score" tile. Deliverable = a complete table like the one above, one row per displayed number. **No fix in this WO — enumeration + proxy flags only.**
