# Aegis Tenant-Isolation Remediation Plan — 6 Surfaces

**Created:** 2026-05-30
**Scope:** Exact-execution plan for the 6 UNSAFE surfaces proven in Task #105 (Aegis Retrieval & Tenant Scope Proof Exercise).
**Status:** PLAN ONLY. No implementation. No branch. No code. No migration. No deploy. No remediation execution.
**Authority:** Operator-requested Task #106. Each surface needs separate operator GO before execution.

**Inputs:** Task #105 execution-path proof; Vince reconciliation 2026-05-30; INC-AEGIS-TRUST audit; INC-AEGIS-ACTION-INTEGRITY audit; INC-CRT-VISIBILITY remediation pattern (PR #11 / PR #12); PROD-EE pattern (`get_recent_signals` fix at `_shared/handlers-signals-incidents.ts:97-149`); C.0–C.4 G2 verification template.

---

## §1 — Ranking by operator-stated criteria

Ranking dimensions per Task #106:
1. **Tenant isolation risk** (primary — cross-tenant read/write surface)
2. **Customer trust risk** (visible-defect impact)
3. **Demo failure risk** (likelihood of triggering in the BC Place / FIFA demo)

| Rank | Surface | Isolation risk | Trust risk | Demo risk |
|---|---|---|---|---|
| **R1** | `update_risk_profile` | **CRITICAL** — cross-tenant **WRITE** (mutates other tenants' entities) | HIGH | MEDIUM (less likely to fire in a UI-driven demo, but the worst class of defect) |
| **R2** | `get_active_incidents` | **HIGH** — cross-tenant READ (empirical 52 returned vs 1 in scope; 51 cross-tenant rows in CRT response) | HIGH | **HIGH** — "what's active right now?" is a likely demo question |
| **R3** | `agent_self_assessment` entity count | **HIGH** — cross-tenant overcount (2,966 returned vs 62 in scope) | **CRITICAL** — visibly wrong number to the operator | **CRITICAL** — Vince has historically asked entity-count questions |
| **R4** | `get_signal_incident_status` | **MEDIUM** — cross-tenant READ in list mode + point-lookup leakage | MEDIUM | MEDIUM |
| **R5** | `lookup_ioc_indicator` | **MEDIUM** — caller-dependent (LLM omits `iocClientId` → all-signal search) | MEDIUM | MEDIUM |
| **R6** | Bulk monitoring (`update_entity`) | **LOW** — no leak (action just fails) | **CRITICAL** — capability lie; Aegis claims success on a no-op | **CRITICAL** — Vince's stated bulk-toggle ask is a known demo trigger |

Two cross-cuts deserve flagging because they recur in multiple fixes:
- All 6 surfaces share the same root cause class: **service-role client + tenant scope enforced only at the application layer, with handler-level inconsistency.**
- All 6 fixes share the same regression-test pattern: **synthetic two-tenant fixture roundtrip** (the C.0–C.4 / G2 template).

---

## §2 — Per-surface remediation plan

### R1 — `update_risk_profile` (cross-tenant WRITE)

| Field | Detail |
|---|---|
| **Root cause** | `ai-tools-query/index.ts:370-406` declares `tenant_id` parameter but does **not consume it**. The UPDATE at `:379-390` is `.eq('id', entityId)` with no tenant predicate. Dashboard at `dashboard-ai-assistant/index.ts:4548-4550` invokes ai-tools-query passing `tenant_id: tenantId`, but the receiver ignores it. Compounded by `verify_jwt = false` on ai-tools-query (direct HTTP exploit surface). |
| **Exact files** | `supabase/functions/ai-tools-query/index.ts` (lines 370-406) · `supabase/functions/dashboard-ai-assistant/index.ts:4548-4550` (caller, no change needed if receiver gets fixed) |
| **Exact functions** | `case "update_risk_profile"` body in ai-tools-query |
| **Blast radius** | Single case body. Two reachability paths: (a) dashboard chat → ai-tools-query invoke at `:4550`, (b) direct HTTP exploitation via anon key. Both close with the same receiver-side fix. Affects every operator action that scores threat on an entity (zero today because no operator goes through this path during normal use, but the surface is live). |
| **Proposed fix** | Two-step receiver hardening, both inside the case body: (i) Destructure `tenant_id: callerTenantId` from `parameters`; if absent return `{error: "TENANT_BOUNDARY: tenant_id required"}`. (ii) Validate the target entity belongs to that tenant **before** mutating — `.from('entities').select('id').eq('id', entityId).eq('tenant_id', callerTenantId).maybeSingle()`; if no row, return `{error: "TENANT_BOUNDARY: entity not in your tenant", entity_id: entityId}` (intentionally indistinguishable from "entity does not exist" per the Quarantine Doctrine's read-leak rule). Then the UPDATE itself can keep `.eq('id', entityId)` (already proven to belong to the caller tenant). **Recommended additional hardening (separate operator decision):** flip ai-tools-query to `verify_jwt = true` and require caller to assert tenant from JWT, eliminating direct-HTTP exploitation. |
| **Regression tests required** | T1 — within-tenant write: caller tenantId=A, entity in tenant A → expect success + `threat_score` updated. T2 — cross-tenant write rejected: caller tenantId=A, entity in tenant B → expect `TENANT_BOUNDARY`; no row mutation (verify `entities.threat_score` of tenant-B entity unchanged). T3 — null-tenant caller: no `tenant_id` parameter → expect `TENANT_BOUNDARY`. T4 — non-existent entity: same caller tenantId, garbage UUID → expect "entity not in your tenant" (honest-empty discipline). T5 — direct-HTTP probe: anon-key POST without dashboard mediation → expect `TENANT_BOUNDARY` if tenant_id absent, otherwise governed by T1/T2. |
| **Deployment validation steps** | Staging-first. (1) Seed two-tenant fixtures (tenant A + tenant B with one entity each). (2) Run T1–T5 sequentially; record observed responses + before/after `threat_score` SQL counts. (3) Cleanup fixtures. (4) Prod parity-exact deploy. (5) Run T2 + T4 only on prod (read-side probes that do not require fixture creation). (6) 24-hour edge-function-log observation: no HTTP 500s on `update_risk_profile`; observe expected refusal count. |
| **Notes** | This is the only surface where the defect is a cross-tenant WRITE. Operator may consider gating it behind a separate authorization step independent of the other 5 surfaces. |

---

### R2 — `get_active_incidents` (cross-tenant READ, 51 rows leaked today)

| Field | Detail |
|---|---|
| **Root cause** | `_shared/handlers-signals-incidents.ts:196-256` handler signature is `(args, supabaseClient)`. The dispatcher at `dashboard-ai-assistant/index.ts:482-488` passes `tenantId` as the 4th argument, but the handler does not declare it, so it is silently discarded. SQL at `:200-204` has no `.eq("tenant_id", …)` predicate. Empirical: 52 active incidents returned platform-wide; CRT has 1 in scope; 51 cross-tenant rows leak today on every invocation. |
| **Exact files** | `supabase/functions/_shared/handlers-signals-incidents.ts` (lines 196-256) |
| **Exact functions** | `signalsAndIncidentsHandlers.get_active_incidents` |
| **Blast radius** | Single handler. Caller already supplies tenantId (`dashboard-ai-assistant:488`). Tool is in `TENANT_SCOPED_TOOLS` (`:361`) — gate already passes. No other call site (per `grep -r 'get_active_incidents'` — only the handler definition + the registry entry + the tools-list reference). |
| **Proposed fix** | (i) Widen handler signature to `(args, supabaseClient, _userId, tenantId)`. (ii) Fail-closed `if (!tenantId) return { error: "TENANT_BOUNDARY: get_active_incidents requires an active tenant context.", incidents: [] }` (mirroring the PROD-EE pattern at `:97-103`). (iii) Add `.eq("tenant_id", tenantId)` to the base query (`:201-204`). (iv) When `args.client_id` is supplied by the LLM, validate it against tenant scope before applying the filter — same pattern as PROD-EE at `:115-146` (UUID lookup against `clients` table with `.eq("tenant_id", tenantId)`). (v) Update the response summary block (`:246-251`) — `total_found`, `p1_count`, etc. — to reflect the scoped result set (no code change; the values fall out naturally once the query is scoped). |
| **Regression tests required** | T1 — CRT caller: tenantId=CRT, no client_id → expect ≤10 CRT-only incidents, summary counts reflect CRT scope only (Petronas incidents excluded). T2 — null-tenant caller: tenantId undefined → expect `TENANT_BOUNDARY`. T3 — LLM-supplied valid client_id (CRT-owned): tenantId=CRT, client_id=BC Place → expect BC Place incidents only. T4 — LLM-supplied invalid client_id (Petronas-owned): tenantId=CRT, client_id=Petronas → expect "client not in tenant scope" honest-empty. T5 — empirical comparison: pre-fix prod count of "what CRT sees" should drop from 52 to ≤1; post-fix Petronas-as-Petronas count should be ~23. |
| **Deployment validation steps** | (1) Build green + lint green. (2) Staging-first deploy of `_shared/handlers-signals-incidents.ts`-bearing edge function (which is `dashboard-ai-assistant` — _shared modules ship with their hosts). (3) Run T1–T4 on staging fixtures. (4) Prod deploy. (5) Empirical T5 — invoke `get_active_incidents` from CRT-scoped session against prod; verify ≤1 row returned + summary counts match. (6) 24-hour observation: edge-function-log review of `get_active_incidents` calls; verify no 500s; verify counts are tenant-scoped consistently. |
| **Notes** | The PROD-EE fix pattern (which this mirrors) is operator-approved precedent, deployed 2026-05-24. Apply the identical shape. |

---

### R3 — `agent_self_assessment` entity count (cross-tenant overcount, 2904 entities over-reported)

| Field | Detail |
|---|---|
| **Root cause** | `dashboard-ai-assistant/index.ts:9339` — single-line defect within an otherwise-scoped case. Signals count at `:9337` is `.eq("tenant_id", tenantId)`. Incidents count at `:9338` is `.eq("tenant_id", tenantId)`. **Entities count at `:9339` is missing the predicate.** Empirical: CRT scope=62 entities; query returns 2,966 (global). LLM self-assessment prompt contains `"Total entities monitored: 2966"` for any CRT user. |
| **Exact files** | `supabase/functions/dashboard-ai-assistant/index.ts:9339` |
| **Exact functions** | `case "agent_self_assessment"` body, the `Promise.all` block at `:9332-9340` |
| **Blast radius** | One line. `assertTenantContext` already gates at `:9325`. No call sites to worry about (this is a self-assessment surface invoked only by Aegis as a tool). |
| **Proposed fix** | Change `:9339` from `supabaseClient.from("entities").select("*", { count: "exact", head: true })` to `supabaseClient.from("entities").eq("tenant_id", tenantId).select("*", { count: "exact", head: true })`. **Sub-decision required from operator:** what to do about null-tenant entities (72 rows today). Two doctrinally-clean options: (a) strict tenant_id match — excludes 72 null-tenant rows from every tenant's count (consistent with Provenance Doctrine but produces visible undercounts for tenants whose entities haven't been backfilled); (b) broaden to `client_id IN scopedClientIds` (matches `query_fortress_data` pattern at `:6078`) — includes entities whose `tenant_id` is null but whose `client_id` belongs to the tenant. (a) is cleaner; (b) is more permissive. Recommended: (a) with a separate follow-on to backfill null-tenant entities (INC-XTEN Phase 2C / task #19 territory). |
| **Regression tests required** | T1 — CRT caller: expect entity count = 62 (not 2,966). T2 — Petronas caller: expect 2,823. T3 — counts triangulate: T1 + T2 + 72 (null-tenant) + other-tenant counts should sum to 2,966. T4 — assertTenantContext check: tenantId undefined → existing fail-closed behavior preserved. T5 — LLM-prompt verification: render the self-assessment prompt for CRT scope; assert the substring `Total entities monitored: 62` (not `2966`). |
| **Deployment validation steps** | (1) Build + lint green. (2) Staging deploy. (3) Run T1–T5 with synthetic Aegis invocations (the existing `test-aegis-tools.mjs` smoke harness covers this surface family). (4) Prod deploy. (5) Empirical prod re-run: invoke `agent_self_assessment` from CRT-scoped session; verify response contains "Total entities monitored: 62". (6) 24-hour observation: no error spike on `agent_self_assessment` calls. |
| **Notes** | The smallest fix in this plan. One-line change. Highest-visibility customer trust impact (Vince WILL see the wrong number; correcting it is the lowest-effort highest-trust-return fix in the set). |

---

### R4 — Bulk monitoring (`update_entity` capability lie / V2 Vince)

| Field | Detail |
|---|---|
| **Root cause** | `update_entity` is declared as an Aegis tool in `_shared/aegis-tool-definitions.ts` AND registered in `TENANT_SCOPED_TOOLS` at `dashboard-ai-assistant/index.ts:275`. **No handler case exists** in `_extractedHandlers` or in the legacy switch (`grep` returns zero `case "update_entity"` hits). When invoked, the dispatcher falls to `default: throw new Error("Unknown tool: ${toolName}")` at `:9994-9995`. The persona prompt at `:353/:368` (per INC-AEGIS-ACTION-INTEGRITY audit) authorizes Aegis to claim capabilities; the LLM may surface "I've enabled monitoring for all entities" while the underlying call errored. Edge functions that COULD perform the action — `configure-entity-monitoring`, `aegis-monitor`, `entity-manager`, `apply-monitoring-proposal` — exist in the repo but are **not exposed via the dispatcher**. Same defect class as INC-AEGIS-ACTION-INTEGRITY D1/D2 (denylist drift; phantom registration). |
| **Exact files** | `supabase/functions/_shared/aegis-tool-definitions.ts` (declaration) · `supabase/functions/dashboard-ai-assistant/index.ts:275` (`TENANT_SCOPED_TOOLS` entry) · `supabase/functions/dashboard-ai-assistant/index.ts` (persona prompt sections at `:353/:368`) · `supabase/functions/configure-entity-monitoring/index.ts` (existing-but-unexposed real implementation) · `supabase/functions/_shared/aegis-tool-definitions.ts` for similar phantom `update_client_monitoring_config` (line 280 of TENANT_SCOPED_TOOLS — same defect class) |
| **Exact functions** | The MISSING `case "update_entity"` case in `executeTool`. The persona prompt strings that authorize unconditional capability assertions. |
| **Blast radius** | Two options with very different blast radii: **Option A (minimum-safe, AR2 from INC-AEGIS-ACTION-INTEGRITY)** — remove the phantom. Delete `update_entity` from tool definitions; delete from `TENANT_SCOPED_TOOLS`; update persona prompt to add honest-refusal language. Files touched: 2. Behavior change: Aegis will say "I cannot toggle entity monitoring; please do it in the Entities UI" instead of fabricating. **Option B (AR5, build real capability)** — implement `case "update_entity"` wrapping `configure-entity-monitoring` with tenant-scope validation + post-condition return (AR3). Files touched: 4-6. Behavior change: Aegis can actually toggle monitoring. Significantly larger; depends on Option B operator priority. |
| **Proposed fix** | **Option A (recommended as minimum-safe; mirrors INC-AEGIS-ACTION-INTEGRITY AR2 + AR4):** (i) Delete the `update_entity` declaration from `_shared/aegis-tool-definitions.ts`. (ii) Delete the `update_entity` entry from `TENANT_SCOPED_TOOLS` at `:275`. (iii) Same for `update_client_monitoring_config` at `:280` if it shares the same phantom state (verify separately). (iv) Add to the persona prompt block (location `:353/:368`) an explicit honest-refusal pattern for monitoring-toggle requests: "If asked to toggle, enable, or disable monitoring for entities, respond: 'Monitoring is configured per-entity in the Entities UI. I can help you identify which entities to toggle.'" (v) Consider adding a CI guard (mirroring the `cop-timeline-writer-discipline` pattern from C.2 RC4) that **fails the build if any tool name appears in `TENANT_SCOPED_TOOLS` without a backing case or handler** — implements AR1 (capability list = projection of live registry). |
| **Regression tests required** | T1 — synthetic chat: "Toggle all my entities to monitored" → expect Aegis to honestly refuse + suggest the UI. T2 — synthetic chat: "Turn on monitoring for entity X" (single) → same honest refusal. T3 — registry verification: `update_entity` does not appear in any tool list returned by `list_tools`-style introspection. T4 — CI guard (if shipped): a stub PR that re-adds `update_entity` to TENANT_SCOPED_TOOLS without a case → CI build fails. |
| **Deployment validation steps** | (1) Build + lint green. (2) Staging deploy of `dashboard-ai-assistant` + `_shared/aegis-tool-definitions.ts`. (3) Run T1–T3 chat scenarios on staging. (4) Prod deploy. (5) Re-run T1 on prod via real Aegis chat. (6) 24-hour observation: edge-function-log search for "Unknown tool: update_entity" errors — expect frequency to drop to zero (because tool is no longer in the registry, LLM stops emitting it). |
| **Notes** | This is the V2 Vince case. **Option A is operator-doctrine-aligned** (AR2 no-phantoms + AR4 honest-refusal). Option B is the AR5 "build real capability" path which is explicitly the LAST step in the INC-AEGIS-ACTION-INTEGRITY canonical execution order ("a truthful, limited operator is safer than a powerful, dishonest one"). Operator chooses A or B; A is the recommended starting point. |

---

### R5 — `lookup_ioc_indicator` (caller-dependent cross-tenant IOC verdict)

| Field | Detail |
|---|---|
| **Root cause** | `ai-tools-query/index.ts:810-870` accepts `client_id: iocClientId` parameter optionally. At `:827-829`, **if `iocClientId` is supplied** the query is filtered. **If `iocClientId` is absent** (the LLM may omit it), the query searches all signals platform-wide. Dashboard at `dashboard-ai-assistant:4399` invokes ai-tools-query passing `tenantId` — but ai-tools-query receives `client_id`, not `tenant_id`, and does not validate ownership. Result: Aegis may surface "Yes, hash X was seen 3 days ago in [Petronas signal title]" to a CRT user. |
| **Exact files** | `supabase/functions/ai-tools-query/index.ts` (lines 810-870) · `supabase/functions/dashboard-ai-assistant/index.ts:4395-4410` (caller, may need to pass `tenant_id` in addition to / instead of `client_id`) |
| **Exact functions** | `case "lookup_ioc_indicator"` in ai-tools-query · the invocation block in dashboard-ai-assistant |
| **Blast radius** | Single case body + caller adjustment. Cross-tenant read leak severity HIGH per-call (IOC verdict text plus the source signal's title + URL flow back to the LLM and into the customer-facing answer). Direct-HTTP exploitation surface also exists (same `verify_jwt = false` class as R1). |
| **Proposed fix** | (i) Modify the case to require `tenant_id` parameter (not `client_id`): destructure `const { indicator, indicator_type, tenant_id: callerTenantId } = parameters`. (ii) Fail-closed if `!callerTenantId`. (iii) Resolve scoped client IDs: `const { data: clientRows } = await supabase.from('clients').select('id').eq('tenant_id', callerTenantId); const scopedClientIds = (clientRows ?? []).map(c => c.id);`. (iv) Apply scope to the IOC search: `iocQuery = iocQuery.in('client_id', scopedClientIds.length ? scopedClientIds : ['00000000-0000-0000-0000-000000000000'])` — same impossible-UUID fail-closed pattern used in `query_fortress_data`. (v) Update dashboard caller at `:4399` to pass `tenant_id: tenantId` (already in scope). |
| **Regression tests required** | T1 — CRT caller, indicator known only in tenant A: returns "unknown" / no match (honest empty). T2 — CRT caller, indicator known in CRT: returns match with CRT signal context. T3 — missing tenant_id → `TENANT_BOUNDARY`. T4 — direct-HTTP probe without tenant_id → `TENANT_BOUNDARY`. T5 — empirical: seed a synthetic indicator under tenant B; invoke from tenant-A-scoped Aegis chat; verify Aegis response says "not known" (not "yes, known in [tenant B signal]"). |
| **Deployment validation steps** | (1) Staging deploy of `ai-tools-query` + `dashboard-ai-assistant` (paired). (2) Run T1–T5 with synthetic two-tenant IOC fixtures. (3) Prod deploy. (4) Re-run T2 only on prod (read-only against real data). (5) 24-hour observation: edge-function-log review of `lookup_ioc_indicator` calls; verify all invocations include `tenant_id`; no 500s. |
| **Notes** | Pair this deploy with R1 (`update_risk_profile`) since both fix `ai-tools-query` and both are invoked by the same dashboard caller. **Strongly recommend also flipping `verify_jwt = true` on ai-tools-query as part of this bundle** — eliminates the parallel direct-HTTP exploit surface (would be a separate operator-decision flag). |

---

### R6 — `get_signal_incident_status` (cross-tenant signal-incident linkage)

| Field | Detail |
|---|---|
| **Root cause** | `_shared/handlers-signals-incidents.ts:26-81` handler signature `(args, supabaseClient)` discards tenantId. List mode (`:31-37`) queries signals with no tenant filter. Lookup mode (`:39-43`) `.eq("id", signalId)` accepts any signal UUID without ownership validation. Same defect class as R2 (`get_active_incidents`). |
| **Exact files** | `supabase/functions/_shared/handlers-signals-incidents.ts` (lines 26-81) |
| **Exact functions** | `signalsAndIncidentsHandlers.get_signal_incident_status` |
| **Blast radius** | Single handler. Caller already supplies tenantId at `dashboard-ai-assistant:488`. Tool is in `TENANT_SCOPED_TOOLS` at `:363` — gate passes. |
| **Proposed fix** | (i) Widen signature to `(args, supabaseClient, _userId, tenantId)`. (ii) Fail-closed `if (!tenantId) return { error: "TENANT_BOUNDARY: …", signals: [] }`. (iii) List mode (`:31-37`): add `.eq("tenant_id", tenantId)` to the recent-signals query. (iv) Lookup mode (`:39-43`): widen the `.eq("id", signalId)` filter to also require `.eq("tenant_id", tenantId)`. If the signal exists in another tenant, the maybeSingle() returns null and the handler emits the honest "Signal not found" path at `:44`. This is consistent with the Quarantine Doctrine's read-leak rule (404-indistinguishable). (v) Same treatment for the linked-incidents subqueries at `:46-54` (join via `incidents.tenant_id = tenantId`). |
| **Regression tests required** | T1 — CRT caller, list mode: returns CRT-only signals. T2 — CRT caller, lookup mode with CRT signal UUID: returns expected linkage. T3 — CRT caller, lookup mode with Petronas signal UUID: returns "Signal not found" (honest empty). T4 — null-tenant caller: `TENANT_BOUNDARY`. T5 — empirical: count of recent signals returned by list mode for CRT scope should match CRT's actual signal count (not platform-wide). |
| **Deployment validation steps** | (1) Same edge function as R2 (`dashboard-ai-assistant` + bundled `_shared` modules). (2) Staging fixture run of T1–T5. (3) Prod deploy. (4) Empirical T1+T3 on prod from CRT-scoped session. (5) 24-hour observation. |
| **Notes** | Recommend bundling with R2 (same file, same pattern, same caller). Combined PR shape mirrors PROD-EE: one defensive widening of the handler signature family in `_shared/handlers-signals-incidents.ts`. |

---

## §3 — Cross-cutting concerns

### C1 — `verify_jwt = false` on `ai-tools-query`

R1 and R5 both depend on `ai-tools-query`, which has `verify_jwt = false` (verified 2026-05-30, 5 occurrences). Even with the receiver-side tenant validation in R1 and R5, the function remains anon-invocable via direct HTTP. Other unscoped cases in ai-tools-query (`get_recent_signals` `:24`, `get_active_incidents` `:34`, `search_entities` `:44`, `get_entity_details` `:54`, `get_monitoring_stats` `:67`) would remain as direct-HTTP exfil surfaces unless either:
- All cases are individually scoped (large scope), OR
- `verify_jwt` is flipped to `true` + the dashboard caller is updated to pass JWT-derived tenant context (medium scope; bundles cleanly with R1+R5).

**Operator decision required separately.** Not part of R1/R5 minimum-safe scope, but flagged for explicit triage.

### C2 — Handler signature widening pattern (R2, R6)

Both R2 and R6 use the same fix shape: widen the handler signature in `_shared/handlers-signals-incidents.ts` to accept `(args, supabaseClient, _userId, tenantId)`. The dispatcher already passes these. Other handlers in the same module with the same defect (per Task #105 findings):
- `search_investigations` (`:267-275`) — likely UNSAFE (not exhaustively verified)
- `search_clients` (`:277-286`) — likely UNSAFE
- `get_client_details` (`:287-305`) — likely UNSAFE
- `get_monitoring_status` (`:341-362`) — UNSAFE confirmed
- `get_failed_scans` (`:551-578`) — UNSAFE confirmed

**These are NOT in the operator's Task #106 scope** but are in the same class as R2/R6. Operator may choose to bundle them under a single "handler-signature audit + sweep" PR, or treat them separately.

### C3 — CI guard (capability registry projection)

R4's recommended CI guard (fail build if a TENANT_SCOPED_TOOLS entry has no backing case/handler) is AR1 from INC-AEGIS-ACTION-INTEGRITY. Pattern mirrors C.2 RC4 (`scripts/check-cop-timeline-writer-discipline.mjs`). Transitional per `feedback_regex_ci_guards_are_transitional` — long-term enforcement should trend toward type-level / DB-level guarantees.

### C4 — INC-AEGIS-ACTION-INTEGRITY AR3 (post-condition receipts)

Not in minimum-safe scope for any of the 6 surfaces but particularly relevant to R1 (`update_risk_profile`) and R4 (bulk monitoring): the doctrine recommends every mutating tool re-read and return the measured post-condition, not just claim success. If R1 ships, consider including a `select()` after the `.update()` and returning the post-state in the response — surfaces drift if the persona prompt fabricates beyond what the DB records.

---

## §4 — Suggested deployment sequencing (operator decides)

Two coherent shapes for ordering execution (not authorized; presented for operator review):

### Sequence A — Smallest-surgical-fixes-first

1. R3 (`agent_self_assessment` entity count) — one-line change; highest customer-trust delta per LOC.
2. R2 + R6 (handler signature widening in `_shared/handlers-signals-incidents.ts`) — bundled PR.
3. R4 (bulk monitoring) — Option A phantom removal.
4. R1 + R5 (`ai-tools-query` hardening) — bundled PR; consider `verify_jwt = true` flip in the same PR.

### Sequence B — Highest-risk-first

1. R1 (cross-tenant WRITE).
2. R2 (largest cross-tenant READ surface).
3. R3 (visibly wrong number).
4. R4 (capability lie).
5. R5 + R6 (medium-severity reads).

Either sequence is operator-acceptable; the **deploy-bundles** (R2+R6 in `_shared/handlers-signals-incidents.ts`, R1+R5 in `ai-tools-query/index.ts`) are natural groupings that survive both sequence shapes.

---

## §5 — Regression test infrastructure required (shared across all 6)

All 6 surfaces share the same regression-test pattern. Shared infrastructure that should exist before any execution begins:

- **Two-tenant synthetic fixtures.** Synthetic tenants `tenant_a` + `tenant_b` (mirror the existing `_invariant_tenant_a` / `_invariant_tenant_b` test fixtures in prod) with one entity, one incident, one signal, one IOC each. Used by every test plan above.
- **Aegis chat synthetic harness.** Replicates the dashboard tenant derivation flow and emits tool calls deterministically. The existing `scripts/test-aegis-tools.mjs` smoke harness covers the family; may need extension for cross-tenant probe shapes.
- **Edge-function-log query helper.** Existing `mcp__plugin_supabase_supabase__get_logs` + Aegis Flight Recorder (`aegis_trace_replay('<debug_trace_id>')`) reconstruct prompt→retrieval→tools→grounding→response — useful for post-deploy validation.
- **Empirical-count comparison SQL.** The queries used in Task #105 (`SELECT COUNT(*) WHERE tenant_id = X` vs platform-wide) are the validation oracle. Should be templated for each surface.

---

## §6 — Held

- No fixes implemented.
- No code, branch, migration, or deploy.
- No memory updates.
- No incident document amendments.
- No remediation roadmap beyond this plan.
- No surface modifications beyond what is described.

Plan complete. Each surface requires separate operator GO before execution. Recommended bundling and sequencing presented for operator review.

Task #106 stays in_progress until operator authorizes execution or marks plan as accepted.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
