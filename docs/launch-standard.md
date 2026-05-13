# Launch Standard — CRT Tenant Onboarding

**Source:** Operator + Claude synthesis, 2026-05-13. Refines `crt-stabilization-plan.md` priorities based on the real risks of running a paying tenant.
**Premise:** A schema correctness audit is not the same as a launch readiness audit. The audit (`pre-crt-audit-2026-05-13.md`) tells us what's broken. This document tells us **what must be true before CRT logs in.**

---

## The four real launch risks (ranked)

Schema bugs are catchable. The four below are the risks that destroy tenant trust before they hit a bug tracker.

### 1. Runtime degradation
Signal ingestion slows. Agent queues back up. OpenAI timeouts cascade. Edge functions silently fail. Retry storms.

**Why this is #1:** Staging won't expose any of these — they only emerge at production load. The only mitigation is real-time observability with alerts that fire fast.

### 2. Signal quality regression
The platform works *technically* but produces garbage: duplicate junk signals, irrelevant news, weak attribution, hallucinated source reasoning.

**Why this matters more than downtime:** A 30-minute outage you can apologize for. A week of bad signals destroys the analytical credibility the platform is sold on.

### 3. Tenant isolation failure
The existential risk. If CRT ever sees another tenant's data — Petronas's, Cascade Energy's, or another paying tenant's once the second one onboards — game over.

**Why this requires red-teaming, not just RLS unit tests:** "It seems fine when I logged in as two users" is not proof. Active attack patterns are.

### 4. Support escalation failure
User hits chatbot, gets vague answer, no escalation path, frustration loops, no human notified. Trust collapses operationally even when the platform technically works.

**Why this is bottom of the four:** It's the most fixable in real time. If you see CSAT drop, you can intervene the same day. The other three can damage you before you notice.

---

## Config-as-code — what to control vs what to leave alone

Don't make everything config-as-code. That over-engineering kills velocity. The right split:

| Category | Rule |
|---|---|
| Agent prompts (`ai_agents.system_prompt`) | Version controlled. Edits via PR only. |
| Tenant isolation rules (RLS policies, `get_user_accessible_client_ids()`, `tenant_users` schema) | Version controlled + CI test suite |
| Cron schedules | Version controlled |
| Core source types (the `monitor_type` enum + the canonical RSS/API/CSE definitions) | Version controlled |
| Emergency source additions (new RSS feed Aaron adds at 11pm because a story broke) | Admin UI allowed, but logged to `config_audit_log` |
| Agent learning state (`agent_beliefs`, `agent_calibration_scores`, `learning_profiles`) | Production-only runtime state — never in staging, never in migrations |
| Tenant data (signals, incidents, agent analyses) | Production-only |
| Signal history | Production-only |

**Why this split works:** The version-controlled rows are the things where drift is dangerous (silent prompt edits creating regressions, RLS leaks). The Admin-UI-allowed rows are the things where speed matters (an emergency source addition during a real event must not require a PR review).

---

## The Admin UI rule

Admin UI is NOT read-only. It's **controlled**. Every change writes to `config_audit_log`:

```sql
CREATE TABLE config_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,        -- which table was modified
  row_id uuid NOT NULL,            -- which row
  operation text NOT NULL,         -- INSERT / UPDATE / DELETE
  old_values jsonb,                -- snapshot before
  new_values jsonb,                -- snapshot after
  changed_by uuid REFERENCES auth.users(id),
  reason text,                     -- required input from UI on UPDATE/DELETE
  environment text NOT NULL,       -- 'production' or 'staging'
  promoted_from_staging boolean DEFAULT false,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Requirements:**
- AFTER trigger on every protected table (`sources`, `ai_agents`, `clients`, `agent_specialty_embeddings`) writes audit rows.
- UI requires `reason` field before any destructive UPDATE/DELETE.
- Rollback is "INSERT a new row that reverses old_values" — captured in the same audit log.
- Optional promotion-from-staging flag: staging edit → tested → promoted via single button → `promoted_at` timestamp recorded.

**Net effect:** every config change is attributed, justified, rollbackable, and labeled by environment. "Who changed Petronas's monitoring keywords last week and why" becomes a single SQL query.

---

## Launch standard (`✅` / `⚠` / `❌`)

### Must pass before CRT logs in

- ✅ Login works
- ✅ Tenant isolation verified — by `tenant_isolation_test_suite` running in CI, not by "it seemed fine"
- ✅ Ingestion functioning — benchmark accuracy ≥ 0.65, admit ratio in 25–30% band
- ✅ Agent outputs sane — drift verifier (F-011) deployed, calibration scores non-fake (F-009 fixed)
- ✅ Support escalation works — 3-button severity selector, "I need a human" sentinel, SMS-page on critical bug reports
- ✅ Alerts fire — F-016 cost cap, F-017 secret rotation, queue depth, retry storms, failed cron heartbeats
- ✅ Watchdog healthy on prod — < 5 active critical findings
- ✅ Rollback plan exists — tested once on staging, timing documented
- ✅ Backups tested — F-020 DR runbook with one successful test-restore
- ✅ API limits understood — `function_telemetry` aggregated daily, rate-limit map documented per provider

### Can tolerate at launch

- ⚠ Ugly legacy pages (defer cleanup until 30 days post-onboarding — let access logs guide decisions)
- ⚠ Non-critical UI quirks
- ⚠ Imperfect prompt wording on edge cases
- ⚠ Minor analytics gaps
- ⚠ Manual config sync for non-mission-critical rows (provided `config_audit_log` is live)

### Cannot tolerate

- ❌ Data leakage between tenants
- ❌ Broken ingestion (zero signals admitted on any healthy day)
- ❌ Silent failures (regressions that don't fire an alert)
- ❌ No alerting (the operator finds out from CRT, not from the platform)
- ❌ Vague support dead ends (user asks bot for help → bot can't help → no escalation path → user gives up)
- ❌ Hallucinated executive briefings (a brief that fabricates "X happened" without source evidence — brand-breaking)

---

## Re-ranked pre-CRT priorities

Higher-priority items move first, in order of leverage:

| Rank | Item | Maps to audit finding | Effort |
|---|---|---|---|
| 1 | **Tenant isolation test suite** — 10 attack patterns, runs in CI, blocks promotions on any failure | F-007 + F-008 + F-015 dependencies | M (~2 days) |
| 2 | **Support escalation path** — severity buttons, CSAT, "I need a human", SMS-page on critical | New work | M (~1.5 days) |
| 3 | **Watchdog / health alerts that fire** — queue depth, latency p95, retry rate, stale heartbeats → SMS/email | F-014 + F-016 + new | M (~1.5 days) |
| 4 | **Source quality review loop** — daily 06:00 cron samples 20 admitted signals → operator thumbs up/down → tracked as quality metric | New work | M (~1 day) |
| 5 | **Tested rollback plan** — run the 5-min rollback drill on staging once, document timing | New work, low effort | S (~3 hrs) |
| 6 | **`config_audit_log` + triggers + UI reason capture** | New work | M (~1 day) |

Audit BLOCKER items still get done — they slot in around these. Specifically:
- F-012 (benchmark CI) ships first because everything else depends on regression detection
- F-007 + F-008 (RLS + schema) ship just before priority #1 because the isolation test suite needs them
- F-001 (AI gate consolidation), F-009 (calibration parser), F-011 (drift verifier) ship to support priority #4 (source quality)
- F-010 (hallucination layer) is the last big build — drives the "no hallucinated executive briefings" red-line

---

## What this means for the calendar

The original `crt-stabilization-plan.md` estimate was 17-20 focused working days. This re-ranking doesn't add total work — it reorders for the right risks. Same calendar (~3-5 weeks), different sequence.

| Days | Focus |
|---|---|
| 1-2 | F-012 (benchmark CI), F-016 (cost cap), F-017 (secret alerts), F-014 (heartbeat audit) — the foundation |
| 3-5 | F-006, F-004, F-009, F-019, F-018 — data integrity quick wins |
| 6-9 | F-007 + F-008 + F-015 — tenancy / RLS / frontend |
| 9-10 | **Priority #1** — tenant isolation test suite (depends on #7 finishing) |
| 11-12 | **Priority #2** — support escalation path |
| 13-14 | **Priority #3** — watchdog/health alerts |
| 14-15 | **Priority #4** — source quality review loop + F-001 + F-011 |
| 16 | **Priority #5** — rollback drill |
| 17 | **Priority #6** — `config_audit_log` |
| 18 | Final launch standard verification ✅/⚠/❌ — every Must Pass row green |
| 19 | CRT user provisioning + onboarding email |
| 20+ | Pilot phase — daily operating rhythm per `operator-runbook.md` |

---

## The discipline statement

**Staging tests engineering confidence. Production proves operational confidence.**

Before CRT, prioritize the six items above. The audit-driven schema fixes are necessary but not sufficient. The launch standard is what makes onboarding safe — not the absence of bugs.

---

**Last updated:** 2026-05-13 — initial draft synthesizing operator's launch-standard framework with the technical stabilization plan.
