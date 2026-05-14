# Tenant Architecture Audit — 2026-05-13

**Auditor:** Claude (Opus 4.7, 1M context)
**Scope:** Functions that accept user input AND (read/write tenant-scoped data OR use service-role access).
**Mode:** Read-only. Code-level review + schema introspection. No test fires.
**Time-box:** ~90 min evidence + 30 min write-up.
**Goal:** Tell us whether CRT can safely become tenant #2 today, and if not, name what's blocking.

This audit is a companion to `pre-crt-audit-2026-05-13.md`. Findings map to existing F-numbers where possible. New findings are numbered **F-024+**.

---

## Verdict rubric

| Verdict | Meaning |
|---|---|
| **GREEN** | Verified by code reading. Guard present. Compensating control is robust. No runtime test required to trust it. |
| **YELLOW** | Looks right in code but has a runtime-validation gap, OR uses a compensating control that's fragile (prompt-only defense, undocumented assumption about caller, etc). |
| **RED** | Confirmed gap. Service-role used without downstream filter, missing tenant_id propagation, no caller→tenant binding, or similar. |
| **N/A** | Question doesn't apply to this function. |

Each cell carries a tag: `[code-verified]` (read the code, confirmed the answer) or `[needs-runtime-test]` (code looks right but unverified at runtime — flagged for follow-up).

---

## Function × Question matrix

Columns: **Q1** propagation · **Q2** idempotency · **Q3** F-008 gap · **Q4** leakage via data access · **Q5** service-role justified · **Q6** CRT-safe today

| Function | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 |
|---|---|---|---|---|---|---|
| `create-tenant` | 🟢 [code] | 🟡 [code] | 🟢 [code] | 🟢 [code] | 🟢 [code] | 🟡 [code] |
| `process-client-onboarding` | 🔴 [code] | 🔴 [code] | 🟢 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `get-user-tenants` | 🟢 [code] | 🟢 [code] | 🟢 [code] | 🟢 [code] | 🟢 [code] | 🟢 [code] |
| `support-chat` | 🔴 [code] | N/A | 🔴 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `agent-chat` | 🔴 [code] | N/A | 🔴 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `dashboard-ai-assistant` | 🟡 [code] | N/A | 🔴 [code] | 🟡 [runtime] | 🟡 [runtime] | 🔴 [code] |
| `ingest-signal` | 🔴 [code] | 🟢 [code] | 🟢 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `respond-as-agent` | 🟢 [code] | N/A | 🟢 [code] | 🟡 [runtime] | 🟢 [code] | 🟡 [runtime] |
| `briefing-query` | 🔴 [code] | N/A | 🔴 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `speculative-dispatch` | 🟡 [code] | N/A | 🔴 [code] | 🟡 [runtime] | 🟡 [runtime] | 🟡 [runtime] |
| `generate-executive-report` | 🔴 [code] | N/A | 🔴 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |
| `generate-daily-briefing` | 🔴 [code] | N/A | 🔴 [code] | 🔴 [code] | 🔴 [code] | 🔴 [code] |

**Summary verdict per question:**
- Q1 propagation: **RED.** 6 of 12 functions are RED on tenant_id/client_id propagation. Only 1 function (`dashboard-ai-assistant`) actually resolves a caller's tenant via `tenant_users`.
- Q2 idempotency: **YELLOW.** Only `create-tenant` is lifecycle-relevant and has no ON CONFLICT / UPSERT. Other lifecycle paths are N/A.
- Q3 F-008 scope gaps: **RED.** 7 of 8 F-008 tables (all except `filtered_signals`) still lack both `tenant_id` and `client_id`. F-008 has not shipped at all.
- Q4 leakage via data access: **RED.** Service-role bypass without downstream tenant filter is the dominant pattern across the AI surfaces.
- Q5 service-role justified: **RED.** Service-role is used in every function. Almost none pair it with `get_user_accessible_client_ids()` or equivalent.
- Q6 CRT-safe today: **RED.** 8 of 12 functions are blockers. Two are YELLOW pending runtime verification.

**Overall verdict: 🔴 RED — CRT cannot safely become tenant #2 today.**

---

## Findings

### F-007 (existing) — RLS policies are role-only, not tenant-scoped — STILL OPEN

Confirmed via direct policy inspection. Examples of what every authenticated tenant user sees across all tenants:

- `signal_agent_analyses`: `auth.uid() IS NOT NULL` → SELECT all rows for any logged-in user.
- `signal_correlation_groups`: `"Authenticated users can view signal correlations" qual=true` → SELECT every tenant's correlation groups, regardless of role or tenant.
- `agent_debate_records`: `analyst|admin|super_admin` → SELECT all rows.
- `poi_investigations`: `auth.uid() IS NOT NULL` → SELECT all rows.
- `reports`: `analyst|admin` → SELECT all rows.
- `filtered_signals`: `admin|super_admin` → SELECT all rows (despite having client_id).

**The current RLS posture is "role authorizes access to the system," not "role + tenant authorizes access to this tenant's rows."** A tenant analyst at CRT logging in today and querying `/rest/v1/signal_agent_analyses` would receive every Petronas agent analysis. This is the F-007 BLOCKER, unchanged since the original audit.

### F-008 (existing) — Tenant-sensitive tables lack scope columns — STILL OPEN

Schema introspection result:

| Table | tenant_id | client_id | RLS | Policies |
|---|---|---|---|---|
| `signal_agent_analyses` | ❌ | ❌ | ✅ | 2 (role-only) |
| `signal_correlation_groups` | ❌ | ❌ | ✅ | 7 (role-only, one is `qual=true`) |
| `agent_debate_records` | ❌ | ❌ | ✅ | 2 (role-only) |
| `reports` | ❌ | ❌ | ✅ | 2 (role-only) |
| `agent_actions` | ❌ | ❌ | ✅ | 2 (super_admin + service_role) |
| `poi_investigations` | ❌ | ❌ | ✅ | 2 (`auth.uid() IS NOT NULL`) |
| `filtered_signals` | ❌ | ✅ | ✅ | 1 (role-only — `client_id` is unused in policy) |
| `bug_reports` | ❌ | ❌ | ✅ | 4 (user-id + role only) |

Without scope columns, RLS *cannot* enforce tenant boundaries on these tables. The F-008 migration is the precondition for F-007.

### F-023 (existing) — Both AI chat surfaces bypass tenant scope — STILL OPEN

Confirmed for both:
- `support-chat` (line 118 service-role; line 130 manual JWT auth; **no `get_user_accessible_client_ids` filter anywhere**; bug-report insert at line 159 has no tenant binding because `bug_reports` has no tenant column — F-008 dependency).
- `agent-chat` (3 service-role usages; manual JWT auth; **no `tenant_users` or accessible-client filter anywhere in 3932 lines**; tool definitions at lines 1127/1391/1405/1498/1541 accept `client_id` as a tool parameter without verifying caller's tenant matches).

### F-024 (NEW) — `process-client-onboarding` does not set `tenant_id` on the new client

**Severity:** BLOCKER for multi-tenant onboarding.
**Evidence:** `process-client-onboarding/index.ts:82-91`. The INSERT into `clients` carries `name, industry, locations, threat_profile, risk_assessment, status='onboarding'` — but **no `tenant_id`**. The function has no `auth.getUser` call and never resolves the caller's tenant. Result: every client onboarded through this function is **orphaned** — not visible to any tenant via `get_user_accessible_client_ids()`.

This is the CRT-onboarding-day-one bug. If CRT is onboarded with this function, the CRT client row will have `tenant_id = NULL` and CRT users will not see their own client.

**Fix:** read caller JWT, resolve `tenant_id` via `tenant_users`, set on insert. Reject if caller has no tenant. Also worth adding idempotency (don't create duplicate clients for the same `(tenant_id, name)`).

### F-025 (NEW) — `generate-executive-report` and `generate-daily-briefing` are unauthenticated cross-tenant report endpoints

**Severity:** CRITICAL.
**Evidence:**
- Both have `verify_jwt = false` in `supabase/config.toml`.
- Neither contains *any* `auth.getUser` call (grep returns zero matches).
- Both accept `client_id` (or `clientId`) directly from request body.
- Both query signals/incidents/beliefs/etc. by that `client_id` using service role and return the full report.

**Result:** anyone with the anon key (publicly visible in any frontend bundle) can request a complete executive report for any client UUID in the system. The only gate is knowing the target UUID — which is enumerable via prediction or leakage.

The comment in `generate-executive-report:78-79` explicitly acknowledges this and rationalizes it:
> "Authentication at the Supabase gateway layer (verify_jwt = false in config.toml) means callers must have a valid Supabase key (anon, service role, or user JWT)."

**This is wrong.** The anon key is public. "Has a Supabase key" is not authentication. Per memory `feedback_management_api_resets_verify_jwt.md`, `verify_jwt` may have been silently reset by a Management API deploy, but the in-function code never bound the caller in the first place — so even fixing `verify_jwt` doesn't close this; the function must resolve caller tenant and verify `client_id` belongs to it.

**Fix:** Either (a) require JWT + resolve caller tenant + verify `client_id` ∈ `get_user_accessible_client_ids(auth.uid())`, or (b) restrict to service-role only and have the calling frontend page route through an authenticated wrapper.

### F-026 (NEW) — `ingest-signal` accepts arbitrary `client_id` without binding caller to tenant

**Severity:** MEDIUM-HIGH (gated by UUID enumeration; severity rises with tenant count).
**Evidence:** `ingest-signal/index.ts:142` reads `client_id` from request body, validates the client *exists* and is *active*, but never verifies the caller's tenant matches. With `verify_jwt = false`, the caller may be unauthenticated. F-006 (the status-active guard) is the only boundary, and it's about client *state*, not caller identity.

**Why F-006 isn't enough:** F-006 blocks the QA-contamination class. It does not block: Tenant A user posts a signal claiming `client_id = TenantB_active_client`. Today this is theoretical because Tenant A doesn't exist yet — Petronas is the sole active client. With CRT onboarded, it becomes exploitable.

**Fix:** Two layers. (a) If the call comes with a user JWT, resolve caller tenant and reject if `client_id` not in their accessible set. (b) If the call is from an internal cron monitor, require a `service-role`-tier credential (not anon) — i.e. flip `verify_jwt = true` after auditing all callers. Per memory `project_verify_jwt_migration_scope.md`, this function was specifically migrated to `verify_jwt=false` on 2026-05-09 to enable `sb_secret_*` inter-function auth. Reverting needs the inter-function auth path to use `resolveServiceRoleKey(supabase)` from memory `project_legacy_jwt_orchestrator_fix.md`.

### F-027 (NEW) — `briefing-query` authenticates caller but never verifies caller belongs to the queried mission's tenant

**Severity:** HIGH.
**Evidence:** `briefing-query/index.ts:49` calls `auth.getUser()` and rejects if no user. Lines 84-98 then query `task_force_missions` by `mission_id` using service-role, with no filter binding caller's user_id or tenant to the mission. Lines 109-133 fetch related incident signals and entities by `mission.client_id` — again no caller binding.

**Result:** any authenticated user (CRT analyst, Petronas analyst, anyone with a valid JWT) can request the full context of any mission, including signals, entities, and AI agent dispatches, by guessing or learning a mission UUID.

**Fix:** After fetching `mission`, verify the caller's tenant matches `mission.client_id`'s tenant via `get_user_accessible_client_ids(callerId)`. Reject if not.

### F-028 (NEW) — `create-tenant` is not idempotent

**Severity:** MEDIUM (lifecycle hygiene; not a leakage risk).
**Evidence:** `create-tenant/index.ts` has no `ON CONFLICT`, no `.upsert()`, no pre-check for an existing tenant of the same name. Re-running the function for the same caller produces a second tenant row + a second `tenant_users` row.

**Why it matters for account cycling:** The user's Track A goal is "tenant lifecycle is idempotent and repeatable." Without idempotency, re-running creation as part of a smoke test pollutes the data with orphan tenants.

**Fix:** Pre-check for an existing tenant for this user, or add a unique constraint on `(owner_user_id, name)` and handle the conflict. Also add a corresponding `teardown-tenant` function so the cycle is symmetric.

### F-029 (NEW) — `speculative-dispatch` accepts `client_id` from caller without caller-tenant verification

**Severity:** MEDIUM.
**Evidence:** `speculative-dispatch/index.ts:24` destructures `client_id` from body, line 76 passes it to invoked agent-chat. The function has `verify_jwt = true` (gateway protects), but no in-function `auth.getUser`. It treats itself as service-to-service.

**Audit-gap:** Is `speculative-dispatch` called by frontend code, or only by other edge functions? If frontend can call it, any authenticated user can dispatch agent work against any `client_id`. If only edge functions call it, the risk is lower.

**Fix:** Add `auth.getUser` and verify `client_id` ∈ caller's accessible clients. Or formally restrict to service-role callers and audit all entry points.

### F-030 (NEW) — `support-chat` allows unauthenticated bug submission

**Severity:** LOW-MEDIUM (DoS / spam vector, not data leak).
**Evidence:** `support-chat/index.ts:124-137` — if `authHeader` is missing, `userId` stays null but the function still proceeds. Lines 159-174 INSERT into `bug_reports` with `user_id: null, reporter_email: userEmail || bugData.email`. Anyone with the function URL + anon key can spam bug reports.

**Fix:** Require auth header for bug submission, OR rate-limit by IP + email + Cloudflare turnstile if anonymous submission is intentional.

---

## Per-cell evidence (read-only verification trail)

### create-tenant — 🟡 overall

- **Q1 🟢 [code]** Lines 36/142/155: caller is `auth.getUser()`-verified; new `tenant_users` row written with `tenant_id` + `user_id` correctly.
- **Q2 🟡 [code]** F-028: no ON CONFLICT. Re-running with same caller creates a duplicate tenant.
- **Q3 🟢 [code]** Tables touched (`tenants`, `tenant_users`) are not in the F-008 set.
- **Q4 🟢 [code]** Caller is the only writer; tenant is owned by caller; no cross-tenant write path.
- **Q5 🟢 [code]** Service-role is used to write `tenants` (which has tenant-management policies); justified.
- **Q6 🟡** GREEN-eligible once F-028 idempotency lands.

### process-client-onboarding — 🔴 overall

- **Q1 🔴 [code]** F-024: clients inserted with NO `tenant_id`. Orphan-client bug.
- **Q2 🔴 [code]** No idempotency. Re-running creates duplicate orphan clients.
- **Q3 🟢 [code]** `clients` is not an F-008 table.
- **Q4 🔴 [code]** No caller binding → any caller can create a client claiming any data.
- **Q5 🔴 [code]** Service-role + no caller binding = unrestricted client creation surface.
- **Q6 🔴** Hard blocker for tenant onboarding.

### get-user-tenants — 🟢 overall

- **Q1 🟢 [code]** Filters `tenant_users` by `user_id = auth.getUser().id` (line 25, 34).
- **Q2 🟢 [code]** Read-only, idempotency N/A but safe to re-run.
- **Q3 🟢** Not F-008.
- **Q4 🟢** Service-role used to read tenant_users, scope-bound by user_id.
- **Q5 🟢** Compensating control (user-id filter) is robust.
- **Q6 🟢** Safe.

### support-chat — 🔴 overall

- **Q1 🔴 [code]** Bug-report insert has no tenant_id (table has no column; F-008 dependency). User-id only.
- **Q3 🔴 [code]** `bug_reports` is on the F-008 list and still has no scope column.
- **Q4 🔴 [code]** Lookup-by-SIG-number / lookup-by-entity uses service-role and bypasses RLS without any `get_user_accessible_client_ids` filter. F-023.
- **Q5 🔴 [code]** Service-role used without downstream filter on cross-tenant lookups.
- **Q6 🔴** F-023 blocker. F-030 (anon bug submission) is a secondary issue.

### agent-chat — 🔴 overall

- **Q1 🔴 [code]** Tool definitions accept `client_id` from caller without verifying caller's tenant (lines 1127, 1391, 1405, 1498, 1541).
- **Q3 🔴 [code]** Writes into `signal_agent_analyses`, `agent_debate_records` — both F-008 tables with no scope column.
- **Q4 🔴 [code]** Manual JWT auth, then service-role for all data ops; no accessible-client filter. F-023.
- **Q5 🔴 [code]** Same as Q4. Three separate service-role usages, none paired with tenant filter.
- **Q6 🔴** F-023 blocker.

### dashboard-ai-assistant — 🔴 overall

- **Q1 🟡 [code]** DOES resolve `userTenantId` via `tenant_users` (lines 9316-9326). Used correctly for `tenant_knowledge` lookup at 9331. Partial coverage — many other tools in the 10293-line function don't use it.
- **Q3 🔴 [code]** Same F-008 tables touched as agent-chat.
- **Q4 🟡 [runtime]** Code-verified that tenant is resolved; runtime test needed to confirm every tool path applies it before returning signal/entity content.
- **Q5 🟡 [runtime]** 4+ service-role usages; only one path verified to be tenant-scoped.
- **Q6 🔴** Until other tool paths are verified, treat as blocker. (Single best-in-class function in the audit — closest to a template.)

### ingest-signal — 🔴 overall

- **Q1 🔴 [code]** Accepts `client_id` from body; no caller-to-tenant verification (F-026).
- **Q2 🟢 [code]** Dedup logic (URL hash, title prefix, etc.) makes re-runs idempotent.
- **Q3 🟢** `signals` is the canonical table (has `client_id` + `tenant_id`).
- **Q4 🔴 [code]** Write-side leak: a caller can inject a signal targeting any active client.
- **Q5 🔴 [code]** Service-role + `verify_jwt=false` + body-supplied client_id is the textbook leakage shape.
- **Q6 🔴** Blocker once tenant #2 exists.

### respond-as-agent — 🟢 overall (one runtime gap)

- **Q1 🟢 [code]** Caller verified via `auth.getUser()`; channel membership checked at line 130-132.
- **Q3 🟢** Tables touched are channel-scoped; not F-008.
- **Q4 🟡 [runtime]** Caller-must-be-channel-member is correct IF channels are tenant-scoped at create time. Channel creation logic is out of audit scope. Flag for runtime verification.
- **Q5 🟢 [code]** Service-role used after caller-channel-membership check.
- **Q6 🟡 [runtime]** Likely GREEN, pending channel-creation tenant binding verification.

### briefing-query — 🔴 overall

- **Q1 🔴 [code]** F-027: caller verified, but `mission_id` is not bound to caller's tenant.
- **Q3 🔴** Touches F-008 tables indirectly via signals + entities.
- **Q4 🔴 [code]** Cross-tenant read by mission UUID.
- **Q5 🔴 [code]** Service-role + caller authenticated but unbound to mission tenant.
- **Q6 🔴** Blocker.

### speculative-dispatch — 🟡 overall

- **Q1 🟡 [code]** Body-supplied `client_id`, no in-function auth check, but `verify_jwt = true` at gateway.
- **Q4 🟡 [runtime]** F-029. Audit-gap: caller surface unclear (frontend or internal-only?).
- **Q5 🟡 [runtime]** Service-role usage might be acceptable if formally restricted to service-role callers.
- **Q6 🟡 [runtime]** Decide intent (internal-only vs frontend-callable), then bind accordingly.

### generate-executive-report — 🔴 overall

- **Q1 🔴 [code]** F-025: `verify_jwt = false`, no `auth.getUser`, body-supplied `client_id`.
- **Q3 🔴** Writes/reads from F-008 tables and signals.
- **Q4 🔴 [code]** Full cross-tenant report leak via UUID guess.
- **Q5 🔴 [code]** Most severe pattern: anon-key callable + body-supplied client_id + service-role read.
- **Q6 🔴** Critical blocker.

### generate-daily-briefing — 🔴 overall

- Same shape as generate-executive-report. F-025 covers both.
- **Q6 🔴** Critical blocker.

---

## GREEN bar (per refined plan)

CRT is GREEN-onboard-eligible only when **all of** the following hold:

| Precondition | Status today |
|---|---|
| F-007 RLS rewrite shipped (drop role-only policies; require tenant-scoped policies) | 🔴 Not shipped |
| F-008 scope columns shipped on all 8 tables | 🔴 Not shipped (only `filtered_signals` has `client_id`) |
| F-023 chat scope shipped on support-chat + agent-chat | 🔴 Not shipped |
| F-024 process-client-onboarding sets tenant_id | 🔴 Not shipped |
| F-025 executive-report + daily-briefing bound to caller tenant | 🔴 Not shipped |
| F-026 ingest-signal binds caller to tenant | 🔴 Not shipped |
| F-027 briefing-query binds caller to mission tenant | 🔴 Not shipped |
| F-028 create-tenant idempotent | 🔴 Not shipped |
| F-029 speculative-dispatch caller surface defined + bound | 🔴 Not shipped |
| All 12 functions pass Q1–Q5 by code review | 🔴 4 GREEN/YELLOW, 8 RED |
| 15-pattern tenant isolation suite passes on staging with 2 test tenants | 🔴 Suite not built |

**Overall: 🔴 RED.**

---

## Audit gaps (flagged for runtime testing in remediation phase)

- **AUDIT-GAP-1 (respond-as-agent):** Channel creation flow not audited. Are `channels` tenant-bound at create time? If a channel can be created with cross-tenant membership, the channel-member check at respond-as-agent:130 doesn't enforce tenant boundary.
- **AUDIT-GAP-2 (speculative-dispatch):** Is this function exposed to frontend callers, or invoked only by other edge functions? Determines whether F-029 is a leakage path or just a tightening opportunity.
- **AUDIT-GAP-3 (dashboard-ai-assistant):** Function is 10293 lines; only the `tenantKnowledgeContext` path was verified to use `userTenantId`. Other tool paths (signal lookup, entity lookup, incident lookup) may not apply tenant scope. Needs path-by-path verification.
- **AUDIT-GAP-4 (cron-triggered ingest):** Functions like `monitor-news-google` write to `ingest-signal` with service-role credentials. Confirmed out-of-audit-scope per the refined scope filter (no user input), but the trust path from cron → ingest-signal needs documenting before F-026 changes the auth posture.

---

## Recommended sequencing (remediation, not part of this audit)

This audit is read-only and does not propose execution. The natural sequencing implied by the findings is:

1. **F-008 first** — without scope columns, F-007 has nothing to filter on. Schema change is the floor.
2. **F-024 + F-025 + F-026 + F-027 in parallel** — caller-tenant binding on the four cross-tenant leakage functions. Each is a focused, self-contained fix.
3. **F-007 second** — drop role-only RLS, replace with tenant-scoped policies using the new scope columns.
4. **F-023** — chat scope on support-chat + agent-chat, using `get_user_accessible_client_ids` as the consistent filter.
5. **F-028** — idempotency on create-tenant; add teardown-tenant for symmetric account cycling.
6. **F-029, F-030, AUDIT-GAP-*** — tightening pass, runtime verification.
7. **15-pattern isolation test suite** — empirical proof, CI-gated.
8. **Cycle `_qa_test_client` 5–10 times** on staging — provisioning regression (per refined scope, this is *not* the CRT account-cycling product capability; that's Track B).

Only then: CRT becomes tenant #2.

---

## Doc maintenance

New findings F-024 through F-030 should be folded into `pre-crt-audit-2026-05-13.md` under the findings table so the canonical audit doc stays the single source of truth. This file remains the evidence trail and matrix snapshot.
