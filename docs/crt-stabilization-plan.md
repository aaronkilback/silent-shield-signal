# CRT Stabilization Plan v2 — 2026-05-13

**Source audit:** `docs/pre-crt-audit-2026-05-13.md` (23 findings, 10 BLOCKERS)
**Source standard:** `docs/launch-standard.md` (Tier 0 / 1 / 2 framework)
**Demo date:** 2026-05-14 (tomorrow)
**Onboarding window:** Tier 0 must be true before CRT users are provisioned. Realistic target: 4-5 calendar weeks post-demo.
**Owner:** Aaron Kilback (operator) + Claude as co-author

This plan is the linear sequence of work. The findings are individually documented in the audit. The priority framework lives in the launch-standard. This document is the **execution order** that reconciles both.

---

## Operating rules during execution

1. **One finding per branch / PR.** No bundled commits. Each step is independently revertible.
2. **Staging benchmark gates `staging → main` PRs.** F-012 must land first (Day 1). After that, every step ends with a "staging benchmark accuracy ≥ previous green" check. Drops >5% block the merge.
3. **Production benchmark is the second safety net.** Even if staging passes, prod runs the benchmark post-deploy. Two-stage verification.
4. **No fixes during a phase's verification window.** When a phase ships, wait 24h of cron cycles before starting the next. Watch Monitor Health.
5. **Never deploy on a Friday afternoon.** Reserve high-blast-radius phases (3, 5) for Saturday mornings.
6. **Tier 0 is non-negotiable.** If a Tier 0 item slips, CRT does NOT get provisioned that week. No exceptions for friendly-tenant rationalizations.

---

## Pre-demo (today → 2026-05-14)

**Goal:** Do nothing structural. Demo against current state. Prepare a verified-clean path.

### Pre-demo checklist

| Task | Time |
|---|---|
| Verify today's commits (`3e008938` through `3d2acb32`) all landed in prod | 15m |
| Pre-run prod benchmark — confirm decision accuracy ≥ 0.51 baseline | 10m |
| Curate 1-week signal trail (Wet'suwet'en activism + one cyber CVE work well) | 30m |
| Manually trigger a Petronas Daily Briefing from May 12 signals — keep artifact in hand | 15m |
| Have support-chat open in a side window for "how do you debug" demo moments | 0m |
| Skim `pre-crt-audit-2026-05-13.md` + `launch-standard.md` as operator-only references | 10m |

### Pre-demo NO-GO list (hard rules until 2026-05-14 EOD)

- Do not push any function code to prod
- Do not touch RLS policies on prod
- Do not run database migrations on prod
- Do not delete deactivated agents
- Do not change agent prompts
- **Today's shipped commits stay shipped** — `3e008938` (social-unified relaxation), `0d75447a` (ingest-signal fire-and-forget), `1bd2c954` (platform pulse) have been running for hours without issue. If something feels off during the demo, these are the recent changes to check first.

### Demo-day blackout (2026-05-14)

- No code pushes during business hours
- Monitor Health open in a tab; check 5 min before demo, then again after

---

## Phase 0 — Foundation (Day 1-2, post-demo)

**Goal:** Make every subsequent fix observable and revertible. Four steps below; without them, the rest of the plan has no safety mechanism.

### Step 0.1 — F-012: Benchmark in CI (already partially shipped)

Status: shipped in commit `195a1e5f`. Verify by:

1. Push a no-op commit to prod (touch `supabase/functions/_shared/heartbeat.ts` with a comment)
2. Watch the workflow — "Post-deploy benchmark" step should run, store a baseline `signal_creation_accuracy`
3. Push the same change to `staging` — staging-side benchmark workflow fires, stores its own baseline
4. From here forward, every push compares to the previous CI-tagged baseline

**Effort:** 30m verification, not new code.

### Step 0.2 — F-016: LLM cost alert + budget cap

**Files:**
- New SQL migration: `<ts>_llm_cost_tracking.sql` (table + cron + alert function)
- New edge function: `compute-llm-daily-cost`
- `_shared/ai-gateway.ts` — **CACHED** budget check (not per-call DB lookup — module-level cache refreshed every 5 min)

**Implementation note (refined):**
```ts
// _shared/ai-gateway.ts — cache the budget state in module scope
let cachedBudgetState: { capUsd: number; spentToday: number; refreshedAt: number } | null = null;
const BUDGET_REFRESH_MS = 5 * 60 * 1000;

async function getBudgetState(supabase): Promise<{ ok: boolean; spent: number }> {
  if (!cachedBudgetState || Date.now() - cachedBudgetState.refreshedAt > BUDGET_REFRESH_MS) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: spend } = await supabase.from('llm_daily_cost')
      .select('est_usd').eq('day', today).eq('scope', 'global').single();
    const { data: cap } = await supabase.from('llm_budget_caps')
      .select('daily_usd_hard_cap').eq('scope', 'global').single();
    cachedBudgetState = {
      capUsd: cap?.daily_usd_hard_cap ?? 200,
      spentToday: spend?.est_usd ?? 0,
      refreshedAt: Date.now(),
    };
  }
  return {
    ok: cachedBudgetState.spentToday < cachedBudgetState.capUsd,
    spent: cachedBudgetState.spentToday,
  };
}
```

This avoids the DB round-trip on every single LLM call (~6,700/day on monitor-social-unified alone). 5-min stale data is fine for a budget cap.

**Acceptance:** drop alert threshold via SQL to $1; within 30 min, `platform_findings` row appears. Drop hard cap to $1; next LLM call returns `LLM_BUDGET_EXCEEDED`. Reset, verify normal flow resumes.

**Effort:** M, ~1 day. **Default `daily_usd_hard_cap = 200`** (well above current $17/day burn). Lower after observing.

### Step 0.3 — F-017: Secret rotation alerts (already shipped)

Status: shipped in commit `195a1e5f`. Already firing 4 alerts for stale LLM keys. Action: **rotate the 4 keys this week** (OpenAI, Anthropic, Gemini, Perplexity) — see new keys section in `docs/runbook-secret-rotation.md` (write this runbook as part of this step).

**Effort:** S, ~2 hours (writing the runbook + rotating).

### Step 0.4 — F-014: Audit remaining monitors for heartbeat drift

Convert any monitor function with 2+ `recordHeartbeat` calls to start/complete pattern. Verified pattern in commit `b9ce0e31` (monitor-news-google).

**Effort:** S, ~3 hours.

**Phase 0 verification gate:**
- Push 3 consecutive no-op commits to prod; benchmark CI runs all 3 cleanly
- Cost alert fires when manually triggered
- 24h post-deploy: every monitor cron shows non-zero `signals_created` in `result_summary` when signals were created

---

## Phase 1 — Data integrity quick wins (Day 3-5)

**Goal:** Stop the leaks. Make the database trustworthy before changing AI behavior on top of it.

### Step 1.1 — F-006: Production-signal-to-inactive-client guard
**Effort:** S, ~2 hours. Symmetric guard in `ingest-signal/index.ts`. Plus backfill the 4 known leaked CCCS signals.

### Step 1.2 — F-004: Source attribution loss

Audit every `INSERT INTO filtered_signals` call site. Require `source_name` to be set with fallback chain: `payload.source_key → raw_json.source → 'unknown:<calling_function>'`.

**Effort:** S, ~3 hours.

### Step 1.3 — F-019: Deactivated agent cleanup

Already partial: `WATCH-ALPHA-2` embedding removed (commit `f7cdeec5`). Decide per-row on the other 16 deactivated agents — reactivate SENT-CON if CRT needs onboarding agent; archive others; document in `docs/agent-changelog.md`.

**Effort:** S, ~2 hours.

### Step 1.4 — F-018: `is_active=false` not enforced consistently

Audit every agent-dispatch path (multi-agent-debate, agent-router, auto-trigger-debates, activate-dormant-specialists, review-signal-agent, respond-as-agent). Add `WHERE is_active = true` filters. Test by confirming Scout (deactivated 2026-05-10) doesn't fire post-fix.

**Effort:** S, ~3-4 hours.

### Step 1.5 — F-009: Confidence-score parsing

**Investigation first** (real grep, not "likely"): find where the `CONFIDENCE: 0.X` line is parsed. Likely sites: `respond-as-agent/index.ts`, `agent-chat/index.ts`. After identifying:

1. Parser change: treat `CONFIDENCE: 0` as ambiguous → store NULL or re-prompt
2. Prompt template: add concrete examples + "DO NOT output 0" instruction
3. Backfill: mark existing 351 `confidence_score=0` rows as `excluded_from_calibration=true`

**Effort:** M, ~1 day (~6 hours).

**Phase 1 verification gate:**
- 7-day query confirms `filtered_signals.source_name IS NULL` count = 0
- 7-day query confirms no `signal_agent_analyses` rows for `is_active=false` agents
- After 14d: new `confidence_score=0` rate < 10% of new analyses
- Spot-check `agent_calibration_scores` — values no longer pinned at 1.000

---

## Phase 2 — Tenancy + RLS (Day 6-9)

**Saturday window for the actual prod RLS swap.** Phase prep can happen mid-week; the cutover is Saturday morning.

### Step 2.1 — F-022 part A: Backport prod-only schema into migrations

Inventory every prod table/column/function that exists but isn't in any migration file. Already known: `get_user_accessible_client_ids()`, `clients.monitored_domains`, `clients.tech_stack`, `clients.tactic_keywords`, `environment_config` table, ~35+ tables surfaced during staging push.

Write a single consolidated migration `<ts>_backport_prod_only_schema.sql`. Apply to staging FIRST — should be a no-op (those things were created during staging stand-up). Apply to prod (via dashboard SQL editor or migration push). Verify with `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'` matches between staging and prod.

**Effort:** M, ~1.5 days.

### Step 2.2 — F-008: Schema migration for tenant-sensitive tables

**Add to F-008 list (was missing): `filtered_signals`, `bug_reports`.**

```sql
ALTER TABLE signal_agent_analyses ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE signal_correlation_groups ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE agent_debate_records ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE reports ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE agent_actions ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE poi_investigations ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE filtered_signals ADD COLUMN tenant_id uuid;
ALTER TABLE bug_reports ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
```

**Verify `signals.tenant_id` is populated before backfill.** If null in production, backfill from `clients.tenant_id` first via JOIN. Run staging side first; observe row counts.

**Effort:** L, ~1.5-2 days. Backfill on prod must be batched (lock contention risk).

### Step 2.3 — F-007: RLS rewrite (single transaction)

**All DROP/CREATE in one transaction.** If any statement fails, the entire rewrite rolls back — leaves prod in either the old state or the new state, never a half-broken middle.

```sql
BEGIN;
  -- All drops + all creates here (see launch-standard.md for full list)
COMMIT;
```

Drop every role-only SELECT policy. Drop wildcard `auth.uid() IS NOT NULL` policies. Drop `current_setting('app.current_client_id')` legacy policies. Keep only `tenant_scoped_*_select` + super_admin bypass.

**Effort:** L, ~2 days (writing the migration + verification under two test users).

### Step 2.4 — F-015: Frontend route guards

Extend `ProtectedRoute` with `requireRole` prop. Annotate routes per the launch-standard's `cannot tolerate` rule — `/super-admin`, `/user-management`, `/tenant-admin`, `/integrations`, `/rule-approvals`, `/agents`, `/agent-actions`, `/benchmark`, `/command-center` all gated.

Add `/forbidden` page with "go home" link.

**Effort:** S, ~half day.

**Phase 2 verification gate:**
- Two test users provisioned on staging — one in Tenant A, one in Tenant B
- Tenant A user runs `SELECT COUNT(*) FROM signals` — only Tenant A's rows
- Tenant A user URL-bars `/super-admin` — redirected to /forbidden
- Same verification on prod, same Saturday morning before declaring done

---

## Phase 3 — Tier 0 launch blockers (Day 10-15)

**These are the items the launch-standard names as "must be true before CRT logs in."** After Phase 2 closes, Phase 3 builds the remaining launch-grade infrastructure.

### Step 3.1 — Tenant isolation test suite (15 attack patterns)

Build `tests/tenant_isolation.spec.ts` with all 15 patterns from `launch-standard.md`. Wire into Fortress CI as a required check. Failure on any pattern blocks the `staging → main` merge.

**Test fixtures:** two `tenant_users` rows in staging, two test clients, seeded rows in every tenant-sensitive table, two auth users.

**Effort:** M-L, ~2.5 days.

### Step 3.2 — F-023: Support-chat scope validation

1. Filter every signal/entity lookup in support-chat by `get_user_accessible_client_ids()` before returning content. Cross-tenant lookups return "signal not found."
2. Prompt-injection defense — system prompt rule: "Never disclose tenant data outside the requesting user's accessible client list."
3. New `support_chat_lookups` audit table: every lookup logged with user_id, queried_value, resolved_client_id, returned_yes_no, timestamp.
4. Attack pattern #6 in the isolation suite gates this.

**Files:** `supabase/functions/support-chat/index.ts` (lookup filtering + prompt update), new migration for audit table.

**Effort:** M, ~1 day.

### Step 3.3 — Minimum hallucination guardrails

NOT full F-010. Four specific behaviors:

1. **Source citation enforced** in every executive brief generation prompt. AI instructed: "Cite each claim with `[Source N]` or write 'insufficient verified data'."
2. **`[Unverified]` badge** when signal has < 2 corroborating sources. UI badge added to brief renderer.
3. **Output-side interceptor** — middleware that scans completed AI output for ungrounded assertions. Replaces with "Insufficient verified data for [topic]" + writes `platform_findings` alert.
4. **Banned phrases blocklist** — "studies show", "experts say", "it is well known", etc. — flagged + rejected pre-output.

**Files:** `_shared/ai-gateway.ts` (output interceptor), `generate-executive-report/index.ts` (citation prompt + banned-phrase check).

**Effort:** M, ~1.5 days.

### Step 3.4 — Watchdog / failure alerting

Build the alerts that actually fire:
- Queue depth (function_jobs pending > 100 → high alert)
- Latency p95 per function from function_telemetry > threshold → medium alert
- Retry storm (any function with 50+ failed attempts in 1h) → critical
- Failed cron heartbeats (status='failed' OR stale >6h) → high alert
- Each alert writes `platform_findings` row → notification path (SMS via Twilio for severity=critical)

**Effort:** M, ~1.5 days.

### Step 3.5 — Tested rollback drill

On staging, deliberately introduce a known regression. Run `git revert <SHA> && git push`. Time the workflow → function redeploy → behavior restored. Document the timing in `docs/runbook-incident.md`.

Practice goal: 5-min from "I want to rollback" to "users see prior version."

**Effort:** S, ~3 hours.

### Step 3.6 — Support escalation path

Build the support-chat features specified in `operator-runbook.md`:
1. 3-button severity selector at end of every bug-report flow (🚨 / ⚠️ / 💡)
2. "I need a human" sentinel detection — files bug_reports row with `severity='human_requested'`
3. SMS via Twilio when `severity='critical'` bug arrives (reuses MFA's Twilio infra)
4. CSAT capture — bot asks "Was this helpful? 1-5 ⭐" at end of every conversation; inserts to new `support_feedback` table

**Files:** `supabase/functions/support-chat/index.ts`, `src/components/SupportChatWidget.tsx`, new migration for `support_feedback`.

**Effort:** M, ~1.5 days.

**Phase 3 verification gate (Tier 0 checklist):**
- [ ] All 15 tenant-isolation attack patterns pass in CI
- [ ] Support-chat returns "not found" when user asks for cross-tenant signal
- [ ] Executive brief generation rejects ungrounded assertions
- [ ] Critical bug report sends SMS within 60 seconds
- [ ] Rollback drill executed once, timing documented
- [ ] Watchdog alerts fire on synthetic queue-depth spike

---

## Phase 4 — AI gate quality (Day 16-18)

**Per launch-standard, signal quality regression is risk #2.** These items don't gate launch but should land in the same sprint.

### Step 4.1 — F-001: AI gate consolidation

Single shared gate at `_shared/ai-relevance-gate.ts`. Ship behind `USE_CONSOLIDATED_GATE=true` flag. Shadow-mode for 48h before flipping. Acceptance: benchmark accuracy ≥ 0.65 (current 0.51).

**Effort:** L, ~2-3 days.

### Step 4.2 — F-002 + F-005: Dormant-agent routing

agent-router reserves 1 top-K slot for least-recently-fired eligible specialist. Acceptance: 5+ previously-never-fired agents fire within 7 days.

**Effort:** M, ~1 day.

### Step 4.3 — F-011: Specialty-fit drift verifier

Pre-storage check on every specialist analysis: "Did this analysis apply [agent.specialty]?" Drop if no. Acceptance: drift rate ≤2/20 sampled.

**Effort:** M, ~1 day.

---

## Phase 5 — Launch verification (Day 19)

Walk the Tier 0 checklist from `launch-standard.md`. Every row green or **CRT does not get provisioned this week.**

- [ ] F-022 schema drift backport — staging and prod schemas match
- [ ] Tenant isolation test suite — 15/15 pass in CI
- [ ] F-023 support-chat scope — test pattern #6 green
- [ ] Minimum hallucination guardrails — output interceptor rejecting test ungrounded assertions
- [ ] Tested rollback plan — documented timing
- [ ] Watchdog + alerting — synthetic test alerts SMS-paging operator
- [ ] Broken escalation path — 🚨 button + "I need a human" both routing correctly
- [ ] Foundation done: F-012 benchmark gating active, F-016 cost cap active, F-017 secret rotation alerting
- [ ] Tenancy done: F-007 + F-008 + F-015 verified under two test users on prod
- [ ] Data integrity done: F-004, F-006, F-009, F-018, F-019 verified per their gates

**If everything green → Day 20.**

---

## Phase 6 — CRT onboard (Day 20)

1. Provision `tenants` row + `tenant_users` rows for Calvin / Vince / Peter
2. Provision initial clients (BC Place first)
3. Send onboarding email per `operator-runbook.md` template
4. Start daily operating rhythm (also in runbook)

---

## Tier 1 work — Week 1 post-onboard

Inside the first 7 days of CRT actively using the platform, complete:

| Item | Effort | Rationale |
|---|---|---|
| `config_audit_log` + triggers + UI reason capture | M (~1 day) | Debugging pain category, not security exposure — Tier 1 not Tier 0 |
| Source quality review loop **Phase 1** — manual sampling, 20 signals/day | S (~half day) | Establishes the baseline for Phase 2/3 automation |
| Route hardening cleanup (legacy admin pages beyond F-015 explicit gating) | S (~half day) | Cosmetics |
| Benchmark gating improvements — per-class accuracy gates not just overall | M (~1 day) | Catches class-specific regressions the overall accuracy hides |
| F-013 — bug_reports.tenant_id | S (~3 hrs) | Companion to F-008, deferred from Phase 2 to keep that phase focused on RLS |

---

## Tier 2 work — Month 1-3 post-onboard

| Item | Effort |
|---|---|
| Source quality review loop **Phase 2** (feedback-assisted ranking) | M (~2 days) |
| Source quality review loop **Phase 3** (automated quality scoring) | L |
| F-010 **full** fact-verification layer (beyond minimum guardrails) | L (~3 days) |
| Calibration architecture refinement beyond F-009 parser fix | M-L |
| Learning state sophistication (belief decay, dormant activation) | L |
| F-011 drift verifier full coverage | M-L |
| Automation refinements throughout the agent layer | M-L |

**Don't accidentally hire yourself into permanent QA.** Phase 1 manual sampling exists for 4 weeks max — then build the automation.

---

## Total calendar

| Phase | Days | Effort |
|---|---|---|
| Pre-demo + demo day | -1 to 0 | 1 hour prep |
| Phase 0 — Foundation | 1-2 | ~2 days |
| Phase 1 — Data integrity | 3-5 | ~3 days |
| Phase 2 — Tenancy + RLS | 6-9 | ~4 days (Saturday cutover) |
| Phase 3 — Tier 0 launch blockers | 10-15 | ~6 days |
| Phase 4 — AI gate quality | 16-18 | ~3 days |
| Phase 5 — Launch verification | 19 | 1 day |
| Phase 6 — CRT onboard | 20 | 1 day |
| **Total to onboard** | **20 working days** | **~4 calendar weeks at 6 focused hrs/day** |
| Tier 1 post-onboard | +7 | ~3-4 days |
| Tier 2 ongoing | +60-90 | ~3-4 weeks distributed |

**Realistic with 30-50% execution buffer** (today's "1-2 hr staging stand-up" took most of a day): **5-6 calendar weeks to CRT onboard.** Build that into the CRT contract conversation.

---

## What's different from v1 of this plan

For history — if anyone reads the old plan and wonders why it changed:

1. **Plan v1 had F-010 (hallucination) in Phase 4 (last).** Contradicted launch-standard saying "hallucinated executive briefings = cannot tolerate." v2 splits F-010 into minimum guardrails (Tier 0, Phase 3) and full fact-verification (Tier 2).
2. **Plan v1 didn't include F-022 (schema drift backport).** Added as Phase 2 Step 2.1.
3. **Plan v1 didn't include F-023 (support-chat as privileged attack surface).** Added as Phase 3 Step 3.2.
4. **Plan v1 listed 10 tenant-isolation attack patterns.** v2 lists 15 (added JWT tampering, stale session, UUID walking, storage cross-tenant, realtime/websocket).
5. **Plan v1 had `filtered_signals` and `bug_reports` missing from F-008 schema list.** v2 includes them.
6. **Plan v1 used six-priority ordering.** v2 uses Tier 0/1/2 framework matching `launch-standard.md`.
7. **Plan v1 had F-016 budget check as per-LLM-call DB query.** v2 specifies module-level cache (5-min stale).
8. **Plan v1 had F-007 RLS rewrite as 8 separate DROP/CREATE blocks.** v2 wraps in single transaction.
9. **Plan v1 didn't have F-023 mitigation for support-chat.** v2 has dedicated step.
10. **Plan v1 had source-quality-review as a single daily 20-signal review.** v2 phases manual → assisted → automated to avoid founder-tax.

This v2 reconciles the audit, the launch-standard, and the operator's product-vs-experiment framing. Single source of truth for "what to do, in what order, before CRT."

---

**Last updated:** 2026-05-13 v2 — third-pass review by operator + Claude.
