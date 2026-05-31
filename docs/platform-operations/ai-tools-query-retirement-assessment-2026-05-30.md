# `ai-tools-query` Retirement Assessment — 2026-05-30

**Read-only assessment.** No implementation. No code. No branch. No configuration change.

**Inputs:** Task #110 trust-boundary assessment + grep against repo + tool-definition inspection. Builds on PR #79 hardening of the two live cases.

---

## §1 — Per-tool migration analysis

### 1a. `lookup_ioc_indicator`

| Field | Detail |
|---|---|
| **Current execution path** | LLM emits `lookup_ioc_indicator` tool call → `dashboard-ai-assistant.executeTool()` → TENANT_SCOPED_TOOLS gate at `:467` passes → local case at `dashboard-ai-assistant:4396` → `assertTenantContext` → `supabaseClient.functions.invoke("ai-tools-query", { body: { toolName, parameters: { ...args, tenant_id: tenantId } } })` → HTTP POST to `ai-tools-query` → `case "lookup_ioc_indicator"` body at `ai-tools-query:846` → tenant-scope resolution → SQL search on `signals` → JSON response → bubble back to dashboard → bubble back to LLM. |
| **Dependencies** | Inside the ai-tools-query case body (post-PR #79): (1) `supabase` service-role client (env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). (2) Read on `clients` (scoped client_ids resolution). (3) Read on `signals` with FK join to `clients`. (4) No RPCs. (5) No external HTTP. (6) No shared module imports. |
| **Shared logic reused elsewhere?** | None. The case body is self-contained. `ai-tools-query/index.ts` exports nothing; it is a standalone `Deno.serve` handler. No other edge function imports from it. |
| **Migration complexity** | **Low.** The case body is ~50 lines (post-PR #79). Dashboard already has every helper needed: `assertTenantContext` (existing), `getScopedClientIds` (existing helper at `:421` — would replace the duplicate scoped-client resolution inline in ai-tools-query). Tool definition in `aegis-tool-definitions.ts:2093` stays unchanged. The dashboard case at `:4396` shrinks from "invoke + error-handle + return result.result" to direct case body. |
| **Estimated blast radius** | **Single file: `dashboard-ai-assistant/index.ts`.** Two-file deploy IF ai-tools-query is left in place but no longer routed-to (the function decays to dead code). |

### 1b. `update_risk_profile`

| Field | Detail |
|---|---|
| **Current execution path** | LLM emits `update_risk_profile` → dashboard executeTool → gate passes → local case at `dashboard-ai-assistant:4545` → `assertTenantContext` → `supabaseClient.functions.invoke("ai-tools-query", { body: { toolName, parameters: { ...args, tenant_id: tenantId } } })` → HTTP POST → `ai-tools-query:370` case body → SELECT pre-check on `entities` (post-PR #79) → UPDATE on `entities` → JSON response → bubble back. |
| **Dependencies** | (1) Service-role client. (2) Read on `entities` for ownership pre-check. (3) Update on `entities`. (4) No RPCs. (5) No external HTTP. (6) No shared module imports. |
| **Shared logic reused elsewhere?** | None. Same analysis as `lookup_ioc_indicator`. |
| **Migration complexity** | **Low.** Case body is ~25 lines (post-PR #79). Dashboard helpers reused: `assertTenantContext`. No new helper needed. Tool definition in `aegis-tool-definitions.ts:929` stays unchanged. |
| **Estimated blast radius** | Same as 1a — single file (`dashboard-ai-assistant/index.ts`). |

---

## §2 — Three options

### Option A — Keep `ai-tools-query`

| Pros | Cons |
|---|---|
| Zero change cost; no implementation work. | 21 unused/legacy cases continue to exist as maintenance burden. |
| Already done with R1+R5 hardening (PR #79); the two live cases are safe. | 15 unscoped + anon-reachable cases remain a direct-HTTP attack surface (per Task #110, anyone with the anon publishable key can hit them). |
| Familiar architecture; no risk of breaking the migration. | `verify_jwt = false` + service-role-backed + anon-reachable = canonical Aegis Authority Doctrine antipattern (*"service-role untrusted by default"*). |
| Preserves the option to add more tools later via this dispatcher. | Two edge functions to deploy + monitor where one suffices. |
| | Extra HTTP roundtrip on every IOC lookup / risk profile update (latency + failure surface). |
| | Two log streams to correlate when debugging tool-call paths. |
| | Future tool additions inherit the public surface unless authors remember to scope. |

### Option B — Collapse `ai-tools-query` into `dashboard-ai-assistant`

(Migrate the two live cases inline; leave `ai-tools-query` deployed as dead code until separate retirement.)

| Pros | Cons |
|---|---|
| Eliminates the parallel exfil channel for the **routed** path (dashboard no longer invokes ai-tools-query for either tool). | `ai-tools-query` function file remains deployed; the 15 unscoped + anon-reachable cases stay reachable via direct HTTP. Attack surface partially reduced, not eliminated. |
| Caller code at `:4399` and `:4550` simplifies from "invoke + error-handle + bubble" to direct local logic. | dashboard-ai-assistant.ts gets ~75 lines longer (25 + 50). |
| Removes one HTTP roundtrip per call (latency improvement). | The 21 unused cases in ai-tools-query become orphaned but still deployed; cognitive load remains. |
| Both migrated tools already use `assertTenantContext` + dashboard helpers — reuse is seamless. | Two-step retirement (B then C) introduces a transition window where the dead-but-deployed function continues to exist. |
| Single-file change; smaller test surface than Option C. | If Option C never follows, the doctrine misalignment continues indefinitely. |
| Reversible by `git revert` and redeploy. | |

### Option C — Retire `ai-tools-query` entirely

(Option B work PLUS delete the function from prod + staging.)

| Pros | Cons |
|---|---|
| **All Option B pros, PLUS:** | Larger change scope than B alone (small absolute, larger relative). |
| The 21 unused cases are physically gone — cannot be revived accidentally. | Need to: (i) migrate 2 cases (Option B work); (ii) update `supabase/config.toml` to remove the `[functions.ai-tools-query]` block; (iii) update `_shared/deployment-verification.ts:19` to remove the function from the verification list; (iv) `supabase functions delete ai-tools-query` against staging + prod; (v) `git rm -r supabase/functions/ai-tools-query/`. |
| One fewer edge function to deploy / monitor / log. | Migration is irreversible (function deleted from prod). |
| Direct-HTTP exfil surface eliminated entirely (no function → no endpoint → no attack). | `agent-chat:1920` still references the function name. Today it falls through to `"Unknown tool"` at the app layer; post-retirement it would 404 at the HTTP layer. Same broken state, different failure mode. |
| Aegis Authority & Memory Doctrine alignment: single trust boundary, no parallel surface. | If any unknown caller exists (none identified in Task #110 grep but absence-of-evidence ≠ proof), they break with 404. |
| Maintenance burden reduced (one less file class to triage on Provenance Doctrine audits, INC-XTEN sweeps, etc.). | |
| Deletion is the only option that fully closes the C1 cross-cutting concern from Task #106. | |

---

## §3 — Recommendation

### Recommended: **Option C — Retire `ai-tools-query` entirely**, executed via two phased sub-steps.

**Phase 1 — Migrate (Option B work):** Move both case bodies into `dashboard-ai-assistant/index.ts`. Replace the existing `supabaseClient.functions.invoke("ai-tools-query", …)` blocks at `:4399` and `:4550` with direct case logic. `ai-tools-query` remains deployed but receives zero traffic from the dashboard.

**Phase 2 — Observe + Delete:** 24–72 hours of edge-function-log review on `ai-tools-query` to confirm zero remaining invocations (catches any unknown caller). Then delete: `git rm`, `config.toml` block removal, `supabase functions delete`, `deployment-verification` registry update.

### Why Option C over A and B

| Criterion | A keep | B collapse only | **C retire** |
|---|---|---|---|
| **Attack surface reduction** | None (15 unscoped + anon-reachable cases stay) | Partial (dashboard path off; direct-HTTP path stays) | **Complete** (no function → no surface) |
| **Operational simplicity** | Worst (2 functions, 23 cases, legacy maintenance) | Mid (1 function still deployed but dead) | **Best** (1 function fewer to maintain) |
| **Doctrine alignment** (Aegis Authority & Memory: *"service-role untrusted by default"*) | Misaligned | Improved | **Fully aligned for this surface** |
| **Maintenance burden** | Highest | Reduced | **Lowest** |
| **Migration risk** | None (no change) | Low | Low–Medium (irreversibility introduces unknown-caller risk; Phase 1+Phase 2 sequencing mitigates) |
| **Cost of work** | Zero | ~75 LOC dashboard addition + caller updates | Option B + ~5 LOC of config/registry updates + delete |
| **Reversibility** | n/a | `git revert` | `git revert` + `supabase functions deploy` to restore |

### What makes Option C achievable now (that wasn't true earlier)

- The six-surface remediation plan (Task #106) is implemented in code across PR #77 / #78 / #79. The two surfaces that actually matter (`lookup_ioc_indicator` + `update_risk_profile`) are tenant-scoped at the receiver layer. Moving them into the dashboard preserves that scoping; the dashboard already enforces the same predicates.
- Task #110 confirmed empirically that no frontend / script / cron / external caller exists. The dashboard is the only live caller.
- The `agent-chat:1920` caller is pre-existing broken (sends `tool` not `toolName`, falls through to "Unknown tool"). Retirement doesn't make it more broken.
- Dashboard already has `assertTenantContext`, `getScopedClientIds`, and the service-role client in scope. Migration is mechanical.
- The 21 unused cases include 2 explicitly marked REMOVED in `aegis-tool-definitions.ts:958-959` (`draft_response_tasks`, `integrate_incident_management`) — the team has already started phasing the function out, just not finished.

### What Option C is NOT a substitute for

- The C2 cross-cutting concern (handler signature class in `_shared/handlers-signals-incidents.ts`: `search_investigations`, `search_clients`, `get_client_details`, `get_monitoring_status`, `get_failed_scans`). These are reached via the dashboard tenant gate which fires, but the handlers ignore tenantId. Retiring ai-tools-query does not touch these.
- INC-LEARN-CONTAM-LEAK (P0.3) — report-generator prompt injection from frozen stores.
- INC-CRT-DOCUMENT-SCOPE (P0.5) — `archival_documents` schema gap.
- The 18 LLM-derived stores Class B Provenance gap.

These remain separate work.

---

## §4 — If Option C is chosen, the work in order

(Plan only — not authorized for execution.)

1. **Pre-flight inventory** (P3 from Task #106 pattern): grep + Aegis Flight Recorder review for any caller of `ai-tools-query` beyond the three known. Verify zero.
2. **Phase 1 migration** — single PR moves:
   - `lookup_ioc_indicator` case body from `ai-tools-query:846` → new local case in `dashboard-ai-assistant.ts` replacing `:4396-4406`.
   - `update_risk_profile` case body from `ai-tools-query:370` → new local case replacing `:4545-4555`.
   - Both reuse existing dashboard `assertTenantContext` + `getScopedClientIds` (eliminates duplicate scoping helpers from the migrated bodies).
   - Build verification + synthetic two-tenant runtime test (mirrors PR #79 validation pattern).
3. **Deploy Phase 1** — staging → 24h observation → prod.
4. **Phase 1 observation window** — 24–72 hours: zero invocation logs on `ai-tools-query` confirms no caller surprises.
5. **Phase 2 deletion** — separate PR:
   - `git rm -r supabase/functions/ai-tools-query/`.
   - Remove `[functions.ai-tools-query]` block from `supabase/config.toml`.
   - Remove `'ai-tools-query'` from `_shared/deployment-verification.ts:19`.
   - `supabase functions delete ai-tools-query` against staging + prod (operator-executed).
6. **Verification** — `gh api repos/.../check-runs` shows no failures; direct curl on `/functions/v1/ai-tools-query` returns 404.

Total effort estimate: ~2–3 hours engineering across two PRs + 24–72h observation gap.

---

## §5 — Held

- No implementation.
- No code, branch, migration, deploy.
- No memory updates.
- No incident document amendments.
- No remediation roadmap beyond this assessment.
- Operator decides between A / B / C; this document recommends C with phased sub-steps but does not authorize execution.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
