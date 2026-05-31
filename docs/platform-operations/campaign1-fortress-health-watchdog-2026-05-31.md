# Campaign 1 — Fortress Health & Watchdog

**Strategic planning only.** No implementation, code, branches, or deploys. Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

**Mission framing for this campaign:** every minute the operator spends investigating a Fortress failure that an automated tripwire could have detected is a minute stolen from the decision interval. Watchdog's job is to compress the *detect-failure* interval to near-zero so the *Signal → Decision → Action* loop remains uninterrupted.

---

## §1 — Current-state assessment

| Layer | Current capability | Operational gap |
|---|---|---|
| Function liveness | `cron_heartbeat` table records start/finish per cron'd function; `system-watchdog` daily reads it. | "Function ran" ≠ "function did useful work." Vince Detection Health Assessment 2026-05-30 surfaced multiple monitors running healthy but producing zero signals. |
| Function behavior | April 24, 2026 behavioral-health phase checks 4 invariants (agent-enrichment coverage, social-monitor signal yield, entity-content freshness, feedback-loop health). | Coverage is hand-curated, four invariants. Doctrine has expanded substantially since: Provenance, Aegis Authority, Grounding-State, Decision Layer — none of these have automated tripwires. |
| Cron drift | `validate-cron-alignment.mjs` script + CI check. | CI surfaced 3 missing live pg_cron jobs (optimize-rule-thresholds-weekly, monitor-threat-intel, monitor-community-outreach-hourly) — known to operator but flagged as pre-existing CI red for ≥24h. Detection ≠ remediation; no auto-clearing path. |
| Tenant-aware health | None — global aggregates only. | A per-tenant signal volume drop (CRT goes from 30/day to 0/day) is invisible if global volume stays similar. |
| Aegis grounding integrity | Aegis Flight Recorder traces exist (`aegis_trace_replay()`); operator-only. | No tripwire fires when Aegis returns ungrounded specifics. INC-CTX-CONTAM (BCH Gender Clinic) was forensically reconstructed *after* operator noticed in chat. |
| Provenance Doctrine compliance | DB CHECK constraints + named-constraint backstops on key tables. | Class B coverage gap (18 LLM-derived stores at 90-99% NULL ownership). No automated detection that new stores comply with the doctrine. |
| Trust-boundary regressions | Manual code review (Tasks #104-#112). | Vince V1/V2/V3/V4 cluster + R1-R6 surfaces were operator-reported, not watchdog-detected. |
| CI cascades | `Fortress CI` workflow includes `Critical File Guard`, `Cron Schedule Alignment`, `DB Types Drift Check`, `Playwright E2E`. | 3-4 pre-existing failures on main left red for 24h+ before triage; no escalation to operator unless they specifically check. |
| Customer-trust simulation | None. | No canned chat-probe that exercises the V1-V4 path and flags regressions before a customer demo. |

**Summary diagnosis:** Watchdog covers *liveness* and a partial slice of *behavior*. It does not cover *doctrine compliance*, *tenant-scoped health*, *Aegis grounding*, or *customer-trust simulation*. The reactive pattern observed throughout 2026-05 (operator notices → forensic reconstruction → fix → deploy) is the opposite of what Commander's Intent requires.

---

## §2 — Existing watchdog architecture

```
Cron schedule (pg_cron)
  └── monitor-* / agent-* / send-* / generate-*
        └── INSERT INTO cron_heartbeat (job_name, started_at, status, …)
        └── (function does its work)
        └── UPDATE cron_heartbeat (completed_at, duration_ms, result_summary)

system-watchdog (daily 13:00 UTC cron)
  ├── Phase 1: liveness check — heartbeats per job in expected interval
  ├── Phase 2: cron_job_registry coverage — flagged jobs vs live
  ├── Phase 3: behavioral health (April 24 addition):
  │     - agent enrichment coverage ≥ 50% of high-sev signals (last 48h)
  │     - social-monitor signal yield ≠ 3 consecutive zero runs
  │     - entity_content freshness < 30 days for active entities
  │     - feedback-loop health: learning_profiles updated when feedback_events exists
  └── emails operator a daily morning brief
```

**Strengths:** simple, in-database evidence, low overhead, doctrine-aware in 4 specific axes, daily cadence matches operator habit.

**Weaknesses:** drift between what's measured and what matters. Recent failure cluster (Vince V1-V4, R1-R6, INC-LEARN-CONTAM, INC-CTX-CONTAM, Path A learning) would have been caught by *none* of the 4 behavioral invariants.

---

## §3 — Existing health-monitor architecture (distributed)

Health signals exist across multiple surfaces, not a single component:

| Surface | What it observes | Where surfaced |
|---|---|---|
| `cron_heartbeat` | function execution result | DB |
| `decision_layer_audit_alerts` (C.1) | cop_timeline_events tenant drift | DB |
| `audit_cop_timeline_events_tenant_drift()` RPC (nightly cron) | per-row drift | DB → alert table |
| Aegis Flight Recorder | per-Aegis-call retrieval+grounding+response trace | DB (`aegis_request_trace`) |
| `aegis_decision_threshold_trace` (R1.0) | future detector audit foundation | DB |
| `universal_learning_log` | what learning Aegis attempted | DB |
| `self_improvement_log` | agent prompt evolution | DB |
| Cloudflare Pages deploy | frontend bundle hash | CF dashboard |
| GitHub Actions | CI + deploy workflows | GitHub |
| Supabase Function Logs | per-invocation HTTP status | Supabase MCP `get_logs` |
| `system-ops` (operator-triggered) | implicit feedback aggregation → AEGIS-CMD beliefs | DB |

**Strength:** rich evidence base; everything Fortress does is logged somewhere.

**Weakness:** no integration plane. The operator (or Claude in a session) reconciles across 11 surfaces manually. The watchdog reads only `cron_heartbeat` + the 4 behavioral checks — it doesn't pull from Flight Recorder, audit_alerts, Function Logs, or the decision-threshold trace.

---

## §4 — Known failures and blind spots

### Specific failures the current watchdog DID NOT catch (2026-04 → 2026-05)

| Failure | Evidence | Why watchdog missed it |
|---|---|---|
| Vince V1 entity-count overcount (2,966 vs 62) | Reconciliation 2026-05-30 | Not a liveness or cron failure; a SQL-scope failure inside a working function |
| Vince V2 bulk-monitoring lie (phantom tool) | Same | Not a function failure at all; a persona-prompt failure |
| Vince V3 archival-document invisibility | Same | Schema gap (no tenant_id column) + silent `[]` return; watchdog doesn't probe for silent empties |
| Vince V4 7-day signed-URL expiry | Same | Not in any watchdog probe set |
| R2 51-row cross-tenant incident leak | Task #105 | Handler signature discarded tenantId; no doctrine-compliance tripwire |
| R5 cross-tenant IOC verdict (190 cross-tenant hits to any caller) | Same | No anon-key direct-HTTP probe |
| Path A learning broken (0 rows lifetime) | Phase 0 audit | Watchdog *did* check the 48h freshness — but the alarm read "haven't updated in 48h" when reality was "haven't updated ever"; the framing understated severity |
| INC-CTX-CONTAM BCH Gender Clinic phrase | Memory `project_inc_ctx_contam` | No Aegis-grounding tripwire |
| INC-LEARN-CONTAM shared stores contaminated | Memory `project_inc_learn_contam` | No content-provenance audit |
| `generate-learning-context` disabled by env flag | Detection Health Assessment 2026-05-30 | Not a missing-cron problem; a "function ran return-early" pattern |
| 3 pre-existing CI failures on main red ≥24h | Task #105 triage | Watchdog doesn't read CI state |
| Cloudflare Pages deploy artifact freshness | Detection Health Assessment | Watchdog doesn't probe live bundles |

### Class-level blind spots

1. **Behavioral semantics vs liveness** — "ran" vs "did its job."
2. **Doctrine compliance** — Provenance, Aegis Authority, Grounding-State, Decision Layer invariants without runtime probes.
3. **Tenant-scoped health** — per-tenant signal volumes, entity counts, retrieval scope.
4. **Aegis quality** — grounding-state violations, ungrounded specifics, prose-lint regressions.
5. **Trust-boundary regressions** — direct-HTTP exfil surfaces, cross-tenant write paths.
6. **CI/deploy cascade** — instrumentation failures (PR #77/#80 benchmark-poll timeouts) marked as "deploy failure" obscure actual deploy success.
7. **Customer-trust simulation** — no canned probes that would have surfaced V1-V4 before a customer demo.
8. **Content-provenance audits** — no automated detection of contaminated stores being read by report generators.

---

## §5 — Top 10 improvements (ranked)

Ranking criteria per operator: operational impact × detection speed × customer impact. Higher rank = closer to Commander's Intent.

| Rank | Improvement | Op-impact | Detection speed | Customer impact | Notes |
|---|---|---|---|---|---|
| **1** | **Aegis grounding tripwire** — every Aegis response runs prose-lint (R1-R6 + R7 tradecraft) and pattern-match against parametric-specifics (entity names not in tenant retrieval). Alert + suppress on violation. | HIGH — closes the INC-CTX-CONTAM class | MINUTES (per-call) | CRITICAL — prevents customer-visible parametric facts | Foundation lives in Workstream D; needs activation + auto-alert path |
| **2** | **Customer-trust simulator** — canned Aegis chat-probe matrix covering the V1-V4 class + R1-R6 class. Runs nightly + on-demand pre-demo. Surfaces regressions automatically. | HIGH — would have surfaced V1-V4 weeks earlier | HOURS (nightly) | CRITICAL — direct demo-failure prevention | New: probe registry + automated invocation harness |
| **3** | **Tenant-scoped health** — per-tenant signal volume, entity count, incident count delta vs 7-day baseline. Alert on -50% drops. | HIGH — would have surfaced "CRT scope = 1 but global = 52" | MINUTES | HIGH — operator sees customer-specific degradation immediately | Extends behavioral-health phase with per-tenant axis |
| **4** | **Doctrine-compliance static + runtime sweeps** — every cron run validates: Provenance backstops still enabled, RLS policies intact, cross-tenant retrieval seam not bypassed, Decision Layer R1.0 schema not drifted. | HIGH — class-level coverage | MINUTES | MEDIUM | Extends C.1 audit RPC pattern (`audit_cop_timeline_events_tenant_drift`) to other invariants |
| **5** | **Content-provenance audit** — automated detection that shared-learning stores stay clean (no tenant-specific phrases in `expert_knowledge` / `global_learning_insights`); flags re-contamination | HIGH — closes INC-LEARN-CONTAM regression class | DAILY | MEDIUM | INC-LEARN-CONTAM containment is freeze-based; this is the gating-condition surveyor |
| **6** | **Anon-key direct-HTTP probe** — canned probes against every `verify_jwt=false` function with anon credentials, verifying tenant-scope on responses | MEDIUM-HIGH — closes the C1 cross-cutting | DAILY | HIGH — catches future "ai-tools-query class" before deploy | Direct curl probe + tenant-isolation assertion |
| **7** | **Reframe behavioral-health alarms with severity gradation** — distinguish "stale 48h" from "never written" from "writer broken." Currently they all surface identically. | MEDIUM | n/a | MEDIUM — reduces operator-confusion cost | Wording-only fix in `system-watchdog`; preserves trust in the watchdog's signal-to-noise ratio |
| **8** | **CI failure escalation** — when `Fortress CI` workflow fails on main, post a daily roll-up to watchdog email. 3 failures red ≥24h triggers `WATCHDOG-ALERT` heading. | MEDIUM | DAILY | LOW-MEDIUM | New: CI status puller in system-watchdog |
| **9** | **Edge-function deploy verification** — after every prod deploy, run a known-input probe; require post-deploy benchmark to actually fire (PR #77/#80 timeout pattern surfaced false-failure conclusions) | MEDIUM | MINUTES | LOW (internal) | Fixes instrumentation correctness in `deploy-functions.yml` post-deploy step |
| **10** | **Decision Frame retroactive audit** — re-score yesterday's signals against the six-element Decision Frame (post-R1.1); flag signals that should have surfaced as a Decision but didn't | MEDIUM (R1.1+ dependency) | DAILY | LOW | Future-gated on Decision Layer R1.x landing |

### Out of top 10 (still useful, lower priority)

- Email + Slack escalation routing (currently email-only)
- Self-improvement-orchestrator activation (allowlisted no-cron pending)
- Watchdog telemetry-on-watchdog (meta health)
- Frontend bundle freshness probe (currently manual)

---

## §6 — Success metrics

Tied to Commander's Intent. Every metric measures interval-compression between *something broke* and *operator can act*.

| Metric | Target |
|---|---|
| **MTTD (Mean Time To Detect)** for grounding violations | < 5 minutes per Aegis call |
| **MTTD** for tenant-isolation regressions | < 1 hour (next nightly probe) |
| **MTTD** for monitor zero-yield drift | < 24 hours |
| **MTTD** for doctrine-invariant drift | < 24 hours |
| **MTTD** for CI failures on main | < 1 hour |
| **Class-coverage %** — doctrine invariants with automated tripwires / total ratified invariants | ≥ 80% by campaign end |
| **Watchdog true-positive rate** | ≥ 95% (alerts that turn out to be real problems) |
| **Watchdog false-positive rate** | ≤ 5% |
| **Customer-visible regressions per quarter** | 0 P0 regressions discovered first by customer |
| **Demo-readiness signal** — fraction of customer demos with green pre-demo simulator run | 100% before BC Place / FIFA delivery |

---

## §7 — Recommended implementation sequence

**Strict gating discipline (mirrors C.0–C.4 pattern):**

| Phase | Scope | Gating prerequisite | Operator GO required? |
|---|---|---|---|
| **W.0** | Reframe existing watchdog alarms with severity gradation (Improvement #7) | None | Yes |
| **W.1** | Anon-key direct-HTTP probe matrix (Improvement #6) — pairs with Phase 2 ai-tools-query retirement post-observation | Phase 2 retirement decision | Yes |
| **W.2** | Tenant-scoped health checks (Improvement #3) | W.0 acceptance | Yes |
| **W.3** | Customer-trust simulator MVP (Improvement #2) — single probe per V1-V4 + R1-R6 surface; nightly cadence; manual GREEN/RED in initial cadence | W.2 acceptance + BC Place / FIFA delivery window | Yes |
| **W.4** | Aegis grounding tripwire (Improvement #1) — Workstream D prose-lint + parametric-specifics matcher hooked to alert table | Workstream D claim-frame UI flipped from dark (separate decision) + W.3 stable | Yes |
| **W.5** | Doctrine-compliance sweeps (Improvement #4) — extend C.1 audit RPC pattern to Provenance + Aegis Authority + Grounding-State invariants | W.4 stable | Yes |
| **W.6** | Content-provenance audit (Improvement #5) | INC-LEARN-CONTAM remediation gate decision | Operator |
| **W.7** | CI failure escalation (Improvement #8) | None blocking | Yes |
| **W.8** | Edge-function deploy-verification fix (Improvement #9) | None blocking | Yes |
| **W.9** | Decision Frame retroactive audit (Improvement #10) | Decision Layer R1.1+ landed (currently locked behind §11 inventory re-run) | Future |

**Total estimated campaign duration:** 6–10 weeks for W.0–W.5 (the customer-trust-critical band), assuming standard C.x cadence. W.6–W.9 separately scheduled.

---

## §8 — How this serves Commander's Intent

*"Preserve decision space by shortening Signal → Decision → Action"* requires the operator's attention to be on decisions, not investigations. Every Watchdog improvement above reduces investigation time in a measurable way:

- Grounding tripwire (W.4): operator never investigates "did Aegis make this up?"
- Customer-trust simulator (W.3): operator never investigates "will the demo go wrong?"
- Tenant-scoped health (W.2): operator never investigates "is CRT seeing the right volume?"
- Doctrine sweeps (W.5): operator never investigates "did some new tool bypass tenant scoping?"
- Behavioral alarms reframed (W.0): operator never investigates a noisy false-positive

Each compresses the interval from "something happened" to "operator knows what to decide." Watchdog isn't a maintenance feature — it's the substrate that makes the Decision Layer trustworthy.

---

## §9 — Held

- No implementation
- No code, branch, migration, deploy
- No initiation of W.0 without operator GO
- All campaign work gated phase-by-phase on prior phase acceptance
