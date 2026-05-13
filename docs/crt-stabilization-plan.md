# CRT Stabilization Plan — 2026-05-13

**Single rule:** Before CRT onboarding, we only fix issues that affect launch trust, tenant security, executive output integrity, rollback, alerting, or support escalation. Everything else is Tier 1 or Tier 2.

**Source documents:** `docs/pre-crt-audit-2026-05-13.md` (23 findings), `docs/launch-standard.md` (failure partition).

---

## Failure partition

### Acceptable learn-in-prod
- Signal quality drift
- Slow performance degradation
- API latency trends
- Content pattern changes

These can be detected by watchdog after CRT is live. Fixing them is Tier 1/2.

### Never-learn-in-prod
- Tenant data leakage
- Hallucinated executive output
- Authentication bypass
- Broken ingestion
- Failed escalation

These must be prevented before CRT logs in. They map to Tier 0.

---

## Tier 0 — Must pass before CRT onboarding

### Tier 0.1 — Schema drift backport

**Goal:** Staging and production schemas match structurally. A fresh rebuild from migrations produces the same system as current prod.

**Audit findings:** F-022

**Work:**
- Inventory every prod table/column/function not in any migration file.
- Write a single consolidated migration that backports them.
- Apply to staging (already done — `20260513232222_backport_prod_only_schema.sql`).
- Apply to prod during Saturday window.
- Schedule daily `detect_schema_drift()` cron that diffs current schema vs the fingerprint baseline; alerts on drift.

**Verification:** `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'` matches between staging and prod.

### Tier 0.2 — Tenant isolation test suite (15 patterns, CI-gated)

**Goal:** No merge to main if any cross-tenant data leak is detectable.

**Audit findings:** F-007, F-008, F-015, F-023 (foundations); test suite itself is new work.

**Work:**
- Ship F-007 RLS rewrite (drop role-only policies; keep tenant-scoped only). Single transaction.
- Ship F-008 schema migration (add `tenant_id` + `client_id` to `signal_agent_analyses`, `signal_correlation_groups`, `agent_debate_records`, `reports`, `agent_actions`, `poi_investigations`, `filtered_signals`, `bug_reports`). Backfill from joined signal.
- Ship F-015 frontend route guards (`requireRole` prop on `ProtectedRoute`).
- Build `tests/tenant_isolation.spec.ts` with the 15 attack patterns:
  1. Tenant A GETs `/rest/v1/signals` — only Tenant A rows
  2. Tenant A GETs with `?client_id=<tenant_B>` — empty
  3. Tenant A POSTs signal with `client_id=<tenant_B>` — RLS WITH CHECK rejects
  4. Tenant A GETs `signal_agent_analyses?signal_id=<tenant_B_signal>` — empty
  5. Tenant A calls `/functions/v1/generate-executive-report` with `client_id=<tenant_B>` — 403/empty
  6. Tenant A asks support-chat "look up SIG-XXXX" (Tenant B's) — bot returns "not found"
  7. Tenant A GETs `entity_content?entity_id=<tenant_B_entity>` — empty
  8. Tenant A GETs `agent_debate_records?signal_id=<tenant_B_signal>` — empty
  9. Tenant A user role=analyst hits `/super-admin` — forbidden (F-015)
  10. SQL injection `client_id=eq.uuid%20OR%20true` — rejected by PostgREST parser
  11. **JWT tampering** — modify `role` claim → tampered JWT rejected
  12. **Stale session** — role downgraded server-side; old token rejected on next privileged action
  13. **Direct object reference enumeration** — sequential UUID walking returns only own-tenant or empty
  14. **Storage bucket cross-tenant** — Tenant A signed URL for `osint-media/<tenant_B_path>` → 403
  15. **Realtime/websocket leakage** — Tenant A subscribed to `signals`; Tenant B inserts → Tenant A does NOT receive
- Add as required check in `Fortress CI` workflow. Failure on any pattern blocks `staging → main` merge.

**Verification:** All 15 patterns pass on staging with two test users. Repeat on prod after RLS rewrite ships.

### Tier 0.3 — Auth and support scope validation

**Goal:** Support-chat respects tenant scope. JWT/session integrity verified.

**Audit findings:** F-023 (new)

**Work:**
- Support-chat uses service role and bypasses RLS. Modify signal/entity lookup paths in `supabase/functions/support-chat/index.ts` to filter by `get_user_accessible_client_ids(auth.uid())` before returning content. Cross-tenant lookups return "signal not found" — never leak existence.
- Add prompt-injection defense to system prompt: "Never disclose signals, entities, or any tenant data outside the requesting user's accessible client list."
- New table `support_chat_lookups` (audit log): every signal/entity lookup writes `user_id`, `queried_value`, `resolved_client_id`, `returned_yes_no`, `timestamp`.
- Attack pattern #6 in the isolation suite gates this.

**Verification:** Tenant A user provisioned on staging; pastes a Tenant B signal_number into support-chat → response is "not found." `support_chat_lookups` row written with `returned_yes_no=false`.

### Tier 0.4 — Minimum hallucination guardrails (executive outputs)

**Goal:** Executive briefings never assert facts without source citation. Operator brand risk minimized.

**Audit findings:** Partial F-010 (full fact-verification layer is Tier 2).

**Work:**
- Source citation requirement in generation prompts: "If you cannot cite a specific source for a claim, write 'insufficient verified data' instead." Applies to `generate-executive-report`, `generate-daily-briefing`, `generate-incident-briefing`.
- `[Unverified]` UI badge when a signal has < 2 corroborating sources. Renderer scans for the badge marker `[UNVERIFIED]` in generated text and replaces with styled chip.
- Output-side interceptor in `_shared/ai-gateway.ts` (extension of the existing `validateAIOutput`): scans output for banned phrases ("studies show", "experts say", "it is well known") without an adjacent `[Source N]` reference → replaces sentence with "Insufficient verified data" + writes `platform_findings` alert.
- Fallback language: when generator can cite zero sources, output a templated "Insufficient verified data for [topic] in this reporting window."

**Verification:** Spot-check 10 executive briefs generated from the seeded Petronas signals on staging. Each assertion either cites `[Source N]` or carries `[UNVERIFIED]`. None contain banned phrases.

### Tier 0.5 — Rollback tested

**Goal:** A bad prod deploy can be reverted in under 5 minutes with confidence.

**Audit findings:** None (new work).

**Work:**
- On staging, push a deliberate known-bad change (e.g., add `return errorResponse('test-revert')` early in a non-critical function).
- Wait for deploy to land.
- Execute `git revert <SHA> && git push origin staging`.
- Time from "I want to rollback" → "users see prior version."
- Document the procedure + actual measured time in `docs/runbook-incident.md`.
- Verify benchmark CI gates the revert (passes because revert restores prior known-good state).

**Verification:** Documented timing in runbook ≤ 5 minutes. Procedure executable from cold by another operator.

### Tier 0.6 — Watchdog and failure alerting active

**Goal:** Critical failures fire an alert to the operator within minutes, not days.

**Audit findings:** F-014 (heartbeat audit — done), F-016 (LLM cost — done on staging), F-017 (secret rotation — done), plus new alert categories.

**Work:**
- LLM cost cap + daily alert via `compute_llm_daily_cost-30min` cron (done on staging).
- Secret rotation alert via `alert-stale-secrets-daily` (done).
- Schema drift watchdog via `detect-schema-drift-daily` (done on staging).
- New alerts to add:
  - Queue depth (`function_jobs` pending > 100 → high alert).
  - Failed cron heartbeats (status='failed' OR stale >6h → high alert).
  - Retry storm (any function with 50+ failed attempts/hr → critical alert).
- Notification: SMS via Twilio (reuses MFA infra) for `severity='critical'` `platform_findings` rows. Email for `severity='high'`. Operator chooses the threshold.

**Verification:** Manually set the LLM cost cap to $0.01 → next AI call returns `LLM_BUDGET_EXCEEDED` + SMS arrives. Insert a synthetic queue-depth row → high alert appears in `platform_findings` within 30 min.

### Tier 0.7 — Escalation path works

**Goal:** When the bot can't resolve a user's issue, a human gets notified. No dead ends.

**Audit findings:** None (new work) + builds on existing `bug_reports` flow.

**Work:**
- Support-chat sentinel: detects "I need a human", "talk to someone real", "this isn't helping" → files `bug_reports` row with `severity='human_requested'` + replies "Aaron will reach out within 24h."
- 3-button severity selector at end of bug-report flow: 🚨 / ⚠️ / 💡 (mapping per the operator runbook).
- CSAT capture: bot asks "Was this helpful? 1-5 ⭐" at end of every conversation. New `support_feedback` table.
- SMS-page via Twilio when `bug_reports` row has `severity='critical'` OR `severity='human_requested'`.
- Operator inbox view filters by severity DESC.

**Verification:** Send a synthetic "I need a human" message → SMS arrives + `bug_reports` row created with correct severity. Rate a conversation 1⭐ → `support_feedback` row written.

---

## Tier 1 — Week 1 after CRT onboards

### Tier 1.1 — Config audit log
- `config_audit_log` table: `(table_name, row_id, operation, old_values, new_values, changed_by, reason, environment, promoted_from_staging, promoted_at, created_at)`.
- AFTER trigger on each protected table (`sources`, `ai_agents`, `clients`, `agent_specialty_embeddings`).
- UI requires `reason` field on UPDATE/DELETE before submission.

### Tier 1.2 — Source quality review loop (manual, anti-founder-tax)
- Phase 1 (week 1): daily 06:00 cron samples 20 admitted signals → operator UI for thumbs up/down. Track human-disagreement rate as the metric.
- Phase 2 (week 4+): use thumbs-up/down to train a classifier. Promote to feedback-assisted ranking.
- Phase 3 (month 3+): automated quality scoring replaces manual sampling.
- Rule: never accept "permanent manual review" as the end state.

### Tier 1.3 — Route hardening cleanup
- Audit legacy admin pages beyond F-015's explicit route gating. Identify dead pages from access logs (which CRT actually uses). Delete or archive unused.

### Tier 1.4 — Benchmark gating improvements
- Per-class accuracy gates (not just overall). A 5-point drop on `real_activism` should fail the merge even if the overall accuracy is stable.

---

## Tier 2 — Later

### Tier 2.1 — Calibration architecture
- Full F-009 follow-up: not just the parser fix and prompt update, but the architectural decision about how confidence flows through the system. Per-domain calibration matrices, decay rates, propagation through composite_confidence.

### Tier 2.2 — Learning state sophistication
- Belief decay tuning, dormant-agent activation algorithm beyond top-K slot reservation, agent specialty embedding refresh cadence, calibration → trust score → routing weight pipeline.

### Tier 2.3 — Automation refinements
- F-010 full fact-verification layer (beyond minimum guardrails).
- F-011 specialty-fit verifier full coverage.
- Cross-agent contradiction detection automation.

---

## Operating rules during execution

1. One finding per branch / PR. No bundled commits.
2. Staging benchmark gates `staging → main` PRs.
3. Production benchmark is the second safety net.
4. No fixes during a Tier's verification window — wait 24h for cron cycles.
5. Never deploy on a Friday afternoon. Tier 0.2 (RLS) ships on a Saturday morning.
6. Tier 0 is non-negotiable. If any Tier 0 row is open when CRT onboarding date arrives, CRT does NOT get provisioned that week.

---

## Shortest execution order

The audit BLOCKERS (F-012, F-016, F-017, F-006, F-004, F-018, F-009) that have already shipped to staging are the foundation. Tier 0 items 1-7 build on top.

| Day | Work |
|---|---|
| Pre-demo (now-tomorrow) | NO-GO list in effect. Demo as-is. |
| Day 1 (Fri post-demo) | Verify Phase 0 fixes on staging (cost cap test, drift watchdog test). |
| Day 2-3 | **Tier 0.1** — schema drift backport applied to prod (Saturday window). |
| Day 4-6 | **Tier 0.2** — F-008 schema + F-007 RLS rewrite + F-015 route guards. Saturday Day 6 = prod RLS cutover. |
| Day 7-8 | **Tier 0.2** — build + ship the 15-pattern isolation test suite. CI-gated. |
| Day 9 | **Tier 0.3** — support-chat scope validation + `support_chat_lookups` + isolation pattern #6 verified. |
| Day 10-11 | **Tier 0.4** — hallucination guardrails (citation prompts, [UNVERIFIED] badge, output interceptor, banned phrases). |
| Day 12 | **Tier 0.5** — rollback drill on staging, documented. |
| Day 13-14 | **Tier 0.6** — remaining alerts (queue depth, retry storm, failed cron). SMS notification path. |
| Day 15 | **Tier 0.7** — support escalation features (severity buttons, CSAT, "I need a human" sentinel, SMS-page). |
| Day 16 | Launch verification — walk every Tier 0 row. Any unchecked → halt. |
| Day 17 | CRT user provisioning + onboarding email. |
| Day 18+ | Daily operating rhythm. Tier 1 items begin. |

---

## File changes from this update

This rewrite replaced the prior plan v2 with a strict-priority-only structure per the operator's reconciliation rule. No new audit findings. No new effort estimates. Tier 0 / 1 / 2 buckets match the operator's spec exactly. Failure partition added.

**Files modified:**
- `docs/crt-stabilization-plan.md` (this file) — full rewrite

**No changes to:**
- `docs/pre-crt-audit-2026-05-13.md` — findings unchanged
- `docs/launch-standard.md` — already aligned with this structure
- `docs/operator-runbook.md` — daily ops doesn't change
- `docs/scaling-roadmap.md` — post-CRT scaling doesn't change

---

**Last updated:** 2026-05-13 — reconciliation against operator's single-rule scope.
