# Option C v2 — Ruthless Security Architecture Review

**Status:** PROPOSED 2026-05-30 — adversarial security review per operator request before re-ratification of Option C v2. **Framing: I am the security architect responsible for preventing a company-ending tenant-isolation incident. This document tells you how Option C v2 fails — not why it is good. Cross-tenant contamination is treated as existential.** No implementation, no schema changes, no migration commit.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-schema-patches-2026-05-29.md` (Option C ADR v2)
- `decision-layer-option-c-cq-recommendations-2026-05-30.md` (CQ v2)
- `decision-layer-option-c-authorization-sheet-2026-05-30.md` (auth sheet v2)
- `architecture-decisions/provenance-contract.md` (Provenance Doctrine)
- Standing memories: `feedback_tenant_isolation_checklist.md`, `project_inc_xten_track_b.md` (INC-XTEN class)

---

## §1 — Executive Summary

**Go/No-Go: NO-GO until five named controls are added.** Option C v2 as currently designed will not, on its own, prevent a company-ending cross-tenant contamination. The strict CQ1 — "tenant_id required + NOT NULL + fail-closed + Provenance" — is necessary but **structurally insufficient**.

Five load-bearing failure conclusions:

1. **The Provenance CHECK constraint only enforces NOT NULL, not correctness.** A writer that derives the wrong tenant still satisfies the constraint. Service-role writers — the dominant data path in Fortress — bypass RLS entirely. The writer's own logic is the **only** safeguard, and writer discipline is exactly what failed in INC-XTEN, INC-CTX-CONTAM, and INC-LEARN-CONTAM.

2. **The two paths can disagree.** If `investigation_workspaces.incident_id` resolves to Tenant A AND `investigation_workspaces.investigation_id` resolves to Tenant B (a data-integrity defect that is not forbidden by any constraint), `COALESCE` arbitrarily picks Path A. The wrong tenant is then stamped on every downstream event silently. **No alarm fires.**

3. **The derived `tenant_id` becomes a denormalized cache the moment any parent table mutates.** Despite CQ6's intent that the column be "authoritative source-of-truth," it is in fact a snapshot. Operator data-cleanup, tenant migration, or backup restore actions create permanent stale tenant scope. The design has **zero drift detection.**

4. **The architecture is brittle to future schema change.** Adding any new FK to `investigation_workspaces` (third path), adding `tenant_id` directly to `investigation_workspaces`, or relaxing NOT NULL on `incidents.tenant_id` each break the chain in a different silent way.

5. **`investigation_workspaces` is the wrong place to anchor tenant scope.** Tenant scope should be **on the workspace itself**, not derived through nullable child FKs to two different parent classes. Option β (the path the operator previously rejected as "do not introduce C.0") is structurally stronger and should be reconsidered. The cost of adding `investigation_workspaces.tenant_id` is one extra phase; the cost of *not* adding it is permanent multi-path derivation fragility across every future table that hangs off the workspace.

**Recommended path: HOLD C.1 v2; require the five controls in §9 before re-authorization.** The strongest of those controls is **promoting tenant scope to `investigation_workspaces` itself** (Option β, reopened on security grounds, not architectural preference).

---

## §2 — Top 10 Ways Tenant Isolation Could Still Fail

Each failure mode is rated on impact (existential / severe / contained), exploitability (passive / active), and detectability (audit-visible / silent).

### F1 — Two-path resolution disagrees, COALESCE picks wrong tenant (DB layer)
**Impact:** Existential. **Exploitability:** Passive (data-integrity defect, not adversarial). **Detectability:** Silent.

Both `investigation_workspaces.incident_id` and `investigation_workspaces.investigation_id` are nullable; nothing forbids both being populated, nor enforces that both resolve to the same tenant. If they disagree, `COALESCE(Path A, Path B)` deterministically picks Path A. Every downstream `cop_timeline_events` insert against this workspace gets the wrong tenant. No alert fires because the row satisfies NOT NULL + the Provenance CHECK. The wrong tenant only surfaces when an operator notices unfamiliar data in a tenant view — exactly the INC-CTX-CONTAM failure mode.

### F2 — `incidents.tenant_id` is NULL on the linked incident (DB layer)
**Impact:** Severe. **Exploitability:** Passive. **Detectability:** Silent unless explicitly audited.

The inventory study found 26 of 60 prod incidents have `tenant_id=NULL` (the ownerless INC-XTEN class). Path A then returns NULL, COALESCE falls to Path B, Path B may or may not resolve. If Path B returns Tenant A but the workspace was conceptually tied to Tenant B (just through the unowned incident), the event lands in the wrong tenant. The chain logic has no notion of which path should "win" semantically.

### F3 — Direct service-role spoofing of tenant_id (Application layer)
**Impact:** Existential. **Exploitability:** Active (developer error or compromised credentials). **Detectability:** Silent.

The Provenance CHECK constraint only requires `tenant_id IS NOT NULL`. It does NOT require `tenant_id = derived_tenant_id_for_workspace`. A service-role writer can `INSERT INTO cop_timeline_events (workspace_id=$A, tenant_id=$B)` and the row inserts cleanly. The RPC is recommended but not mandatory; nothing makes its use compulsory at the schema layer. Any edge function with service-role can produce cross-tenant contamination by mistake (or by intent).

### F4 — RLS bypass via service-role manage policy (RLS layer)
**Impact:** Severe. **Exploitability:** Passive (any service-role caller). **Detectability:** Silent.

The proposed RLS for cop_timeline_events is "service-role manage only." This is intentional — R1.1 needs to read across tenants for the future detector. But it also means every other service-role caller (agent-chat, automated briefings, agent dispatch, monitoring functions, reports) can read AND write any cop_timeline_events row regardless of tenant. The discipline that "service-role queries must carry explicit tenant filters at the SQL level" (per `feedback_tenant_isolation_checklist.md`) is policy, not enforcement. It has failed before.

### F5 — Stale tenant_id after parent mutation (Reporting layer)
**Impact:** Severe. **Exploitability:** Passive (legitimate operator action). **Detectability:** Silent.

If an operator UPDATEs `incidents.tenant_id` (data cleanup, tenant migration), the related `cop_timeline_events.tenant_id` rows stay stamped with the OLD value. There is no trigger to propagate the change. Reports filtering by tenant_id now show stale data. Aegis retrieval pipelines see a tenant view that doesn't match the current incident ownership. **The denormalized cache is implicit and undetected.**

### F6 — Background job writes cross-tenant via stale workspace context (Background jobs)
**Impact:** Severe. **Exploitability:** Active (bug). **Detectability:** Silent.

A background job (agent dispatch, auto-orchestrator) holds a `workspace_id` from when it was triggered. It then writes a `cop_timeline_events` row with that workspace_id. If the workspace's parent relationships changed between trigger and write — e.g., the workspace was reassigned, the parent incident was reclassified — the chain now resolves to a different tenant than the job intended. The job has no way to verify the tenant matches its original intent.

### F7 — Aegis retrieval reads workspace-scoped, not tenant-scoped (Aegis retrieval workflows)
**Impact:** Existential. **Exploitability:** Passive. **Detectability:** Silent.

The Briefing Room read path (currently dormant) queries by `workspace_id`. If R1.1 (or any future Aegis surface) reads cop_timeline_events for a tenant, and the developer assumes "workspace_id implies tenant scope" (the v1 ADR explicitly made this assumption), the read pulls events from a workspace shared across tenants. Tenant_id on the column is correct, but the QUERY doesn't filter on it. This is exactly the COP cross-tenant leak (INC-CTX-CONTAM Class A) reincarnated at the Decision Layer.

### F8 — Future schema change breaks chain silently (Future schema changes)
**Impact:** Severe. **Exploitability:** Passive (developer change). **Detectability:** Silent until audit.

Three named cases:
- Someone adds `investigation_workspaces.workflow_id` (third FK chain). Existing chain logic ignores it. Events tied to workflow-scoped workspaces get NULL or wrong tenant.
- Someone adds `investigation_workspaces.tenant_id` directly. The chain still derives via the old path; the new column is ignored. Two sources of truth coexist; one wins by chance.
- Someone drops the NOT NULL on `incidents.tenant_id`. Path A starts producing more NULLs. Backfill assertions silently pass; new writes silently fall to Path B.

### F9 — Operator restore-from-backup creates inconsistency (Human/operator error)
**Impact:** Severe. **Exploitability:** Active (legitimate incident response). **Detectability:** Silent.

Operator restores `incidents` from a backup taken at T0. `cop_timeline_events.tenant_id` rows that were written between T0 and T_restore using `incidents.tenant_id` values that no longer exist (or have changed) are now orphaned at the parent level but stamped at the child level. No FK violation fires because tenant_id is a UUID, not a FK to a tenant table — yes, **there is no FK from cop_timeline_events.tenant_id to a tenants table**, so referential integrity isn't enforced.

### F10 — Tenant migration mis-syncs (Human/operator error)
**Impact:** Existential. **Exploitability:** Active. **Detectability:** Silent.

Operator moves a client from Tenant A to Tenant B (a real future scenario — corporate restructuring, M&A, tenant consolidation). They update `clients.tenant_id`. They forget that `cop_timeline_events.tenant_id` was denormalized from Path B's chain. The events stay in Tenant A. Tenant B's principal now sees no events; Tenant A's principal sees events about a client they no longer own. **Both tenants see wrong data simultaneously.**

---

## §3 — Assumptions Analysis

### Assumptions the two-path derivation relies on

| # | Assumption | Brittleness |
|---|---|---|
| A1 | `cop_timeline_events.workspace_id` is always non-NULL and references an existing `investigation_workspaces` row | High — current schema allows NULL (nullable column) |
| A2 | Each `investigation_workspaces` row has exactly one populated FK (incident_id OR investigation_id) | **None enforced.** Both can be populated; both can be NULL |
| A3 | When both `incident_id` and `investigation_id` are populated, they resolve to the same tenant | **None enforced.** Data-integrity defect not prevented |
| A4 | `incidents.tenant_id` is non-NULL when an investigation_workspace points to it | False — 43% of prod incidents are tenant_id=NULL today |
| A5 | `investigations.client_id` is non-NULL when an investigation_workspace points to it | Not verified — likely false in some rows |
| A6 | `clients.tenant_id` is non-NULL | True in current prod, but no FK enforcement |
| A7 | Once `cop_timeline_events.tenant_id` is set, the corresponding chain doesn't change | **False by construction** — parent mutations don't propagate |
| A8 | Every writer correctly invokes the chain (or the RPC) | **Policy, not enforcement** — service-role bypass |
| A9 | The chain logic is identical across all writers | **Will degrade over time** — every new writer is a chance to drift |
| A10 | RLS will catch any cross-tenant read | False — service-role bypasses RLS |
| A11 | The `tenant_id` column is the gating signal for tenant scope (vs. workspace_id) | **Not enforced** — readers may still query by workspace_id |

### Brittle assumptions ranked

1. **A8 (writer discipline)** — the same class that failed in INC-XTEN, INC-CTX-CONTAM, INC-LEARN-CONTAM. Trusting writers is the root cause of every prior tenant-isolation incident in this platform.
2. **A2/A3 (workspace ownership consistency)** — nothing forbids contradictory parent assignments. A workspace can semantically straddle tenants.
3. **A7 (tenant_id stays current)** — denormalization without invalidation. The design relies on no one ever updating parents.
4. **A4 (incidents.tenant_id is populated)** — already 43% violated in current prod.
5. **A11 (readers use tenant_id, not workspace_id)** — purely convention; nothing prevents a read filter from being wrong.

### Assumptions that could silently break in the future

- A future migration drops or relaxes NOT NULL on any chain hop
- A future ADR adds a third FK to `investigation_workspaces`
- A future operator action updates a parent without propagating
- A future writer is added that doesn't use the RPC
- A future read path filters by workspace_id instead of tenant_id
- A future tenant-migration script forgets to update derived columns
- A future query planner change alters COALESCE evaluation order

**Each is silent. None has detection. None has automated test coverage proposed in v2.**

---

## §4 — Tenant Resolution Architecture Review

### Should `get_workspace_tenant_id(uuid)` be the single source of truth?

**Yes, but as currently designed it is insufficient.** An RPC that *can* derive tenant_id correctly is not the same as an RPC that *every writer must use*. The RPC creates a convenient seam; it does not enforce one.

The architectural pattern that works in this codebase is **defense in depth across three layers**:

1. **Application layer** — writers call the RPC. (What v2 currently proposes.) Good for developer ergonomics. Cannot prevent bypass.
2. **Database layer** — schema-level constraints or triggers prevent writes that don't match the derived value. (What v2 does NOT propose.) Cannot be bypassed by service-role.
3. **Audit layer** — continuous monitoring detects drift between stored tenant_id and chain-derived tenant_id. (What v2 does NOT propose.)

v2 has only layer 1. INC-XTEN demonstrated that layer 1 alone fails.

### Controls to prevent developers from bypassing the RPC

| Control | Mechanism | Strength |
|---|---|---|
| **C-A: `tenant_id` as TRIGGER-enforced column** | BEFORE INSERT/UPDATE trigger overwrites or rejects `tenant_id` if it doesn't match `get_workspace_tenant_id(workspace_id)` | **Strong.** Service-role cannot bypass. Spoofing is impossible. |
| **C-B: Generated column** | `tenant_id GENERATED ALWAYS AS (subquery)` | Doesn't work — subquery is not IMMUTABLE (same issue we hit in Class A tradecraft). Excluded. |
| **C-C: Composite FK** | `FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspace_tenant_view(workspace_id, tenant_id)` against a materialized canonical map | **Strong** but requires building/maintaining the map. Adjacent to Option β. |
| **C-D: RLS write policy that re-derives** | `WITH CHECK (tenant_id = get_workspace_tenant_id(workspace_id))` on a write policy | Bypassed by service-role. Weak. |
| **C-E: Static-grep CI guard** | Block any `.from('cop_timeline_events').insert(...)` that doesn't go through the shared helper | Policy, not enforcement. Easy to circumvent. |
| **C-F: Audit RPC + alerting** | Periodic `SELECT count(*) WHERE tenant_id != get_workspace_tenant_id(workspace_id)` with alerting | Detective control; doesn't prevent. |

**Minimum recommended set:** C-A (trigger enforcement) + C-F (audit detection). C-E provides developer ergonomics.

If C-A is too costly to implement (it isn't — triggers are simple), the **next-best option is Option β** — promote `tenant_id` to `investigation_workspaces` directly. Then `cop_timeline_events.tenant_id` is one hop, the trigger becomes trivially `tenant_id = (SELECT tenant_id FROM investigation_workspaces WHERE id = workspace_id)`, and the assumption set collapses to A1 + workspace.tenant_id non-NULL.

### What constraints, triggers, policies, or tests should enforce compliance

| Layer | Mechanism | Status in v2 |
|---|---|---|
| Schema | `tenant_id NOT NULL` | ✓ proposed |
| Schema | Named CHECK `tenant_id IS NOT NULL` | ✓ proposed |
| Schema | Trigger `BEFORE INSERT/UPDATE` enforcing chain-match | **❌ not proposed (CRITICAL GAP)** |
| Schema | FK from `tenant_id` to a `tenants` table | **❌ not proposed** |
| RLS | Service-role manage policy | ✓ proposed |
| RLS | Write policy with WITH CHECK re-derivation | ❌ not proposed (bypassed by service-role anyway; lower priority) |
| RPC | `get_workspace_tenant_id(uuid)` SECURITY DEFINER | ✓ proposed |
| Audit | Continuous drift-detection query | **❌ not proposed (CRITICAL GAP)** |
| CI | Static-grep guard on writers | **❌ not proposed (CRITICAL GAP)** |
| CI | RLS test suite | **❌ not proposed (CRITICAL GAP)** |
| CI | Cross-tenant contamination test fixture | **❌ not proposed (CRITICAL GAP)** |

**Five critical gaps.** Each is named in §9 as a Required Control Before Approval.

---

## §5 — Fail-Closed Review

### Every scenario where tenant resolution returns NULL

| # | Scenario | What v2 does | What should happen |
|---|---|---|---|
| N1 | `workspace_id` is NULL on the cop_timeline_events row | Insert fails (NOT NULL on workspace_id assumed; needs verification) | Insert fails ✓ |
| N2 | `workspace_id` points to a non-existent `investigation_workspaces` row | FK violation fails the insert | Insert fails ✓ |
| N3 | `investigation_workspaces.incident_id IS NULL` AND `investigation_workspaces.investigation_id IS NULL` | Both Path A and Path B return NULL; COALESCE returns NULL; NOT NULL constraint fails the insert | Insert fails ✓ — fail-closed works here |
| N4 | `incidents.tenant_id IS NULL` on the linked incident | Path A returns NULL; Path B may or may not resolve; if both NULL, insert fails (good); if Path B resolves to wrong tenant, **insert succeeds with wrong tenant** ⚠️ | Insert should fail OR explicitly select Path B with logged warning |
| N5 | `investigations.client_id IS NULL` on the linked investigation | Path B JOIN drops; Path B subquery returns NULL; Path A determines outcome | Same as N4 — silent path-fallback |
| N6 | `clients.tenant_id IS NULL` | Path B returns NULL; Path A determines outcome | Same |
| N7 | Both paths resolve, but to DIFFERENT tenants | COALESCE picks Path A; Path B's tenant is silently discarded; **insert succeeds with arbitrary winner** ⚠️ | Insert should fail with constraint violation, or require explicit operator override |
| N8 | The RPC throws (subquery error, deadlock, permission failure) | Depends on writer's error handling; might insert NULL (→ constraint fails, fail-closed) or might skip the write silently | Insert must fail loudly; never silent-skip |
| N9 | Workspace is soft-deleted (`deleted_at IS NOT NULL`) | Chain still resolves (subquery doesn't filter deleted); event gets stamped with the deleted workspace's tenant | Behavior should be operator-decided; soft-deleted parents may indicate tenant transition mid-flight |
| N10 | Workspace is hard-deleted between RPC call and INSERT | Race: RPC returned tenant_id, then FK fails on workspace_id | FK fails, insert fails. ✓ |

### Critical fail-not-closed gaps

**N4, N5, N6, N7 are silent fall-throughs.** The design lets one path's failure mask the other path's possibly-wrong success. The RPC and the migration don't distinguish "Path A succeeded" from "Path A returned NULL and Path B picked up." There is no telemetry that records *which path won*.

This is the load-bearing fail-closed defect: **`COALESCE` is fail-open by silent fallback.**

### How detection, alerting, escalation should work

Required (none proposed in v2):

1. **Per-row provenance.** Add a column `tenant_id_derivation_path text` (values: `'path_a_incident'`, `'path_b_investigation'`, `'direct_set'`, NULL). Every write records which path produced the tenant_id. Auditable.

2. **Disagreement alarm.** Periodic audit: `SELECT * FROM cop_timeline_events e WHERE path_a(e.workspace_id) != path_b(e.workspace_id) AND path_a IS NOT NULL AND path_b IS NOT NULL` — any non-empty result is an immediate P1 incident (cross-tenant contamination class).

3. **Stale-cache alarm.** Periodic audit: `SELECT * FROM cop_timeline_events e WHERE e.tenant_id != get_workspace_tenant_id(e.workspace_id)` — any non-empty result is a stale-denormalization incident.

4. **NULL-fallback alarm.** Continuous: any row where the chain derivation returns NULL but the row exists is a constraint-violation case. Should never happen if NOT NULL holds; if it does, surface immediately.

5. **Escalation:** any alarm → page operator → freeze writers on the table → forensic before resume.

### How to prevent future operators from creating temporary bypasses

| Vector | Mitigation |
|---|---|
| Operator sets `tenant_id` directly via service-role psql session | Trigger (C-A above) enforces chain-match. Operator cannot spoof. |
| Operator disables the trigger during an incident response | Audit alert fires on any trigger state change. RBAC restricts who can disable triggers. |
| Operator runs an `UPDATE ... SET tenant_id = X` mass operation | Trigger fires per row; mass-fix attempts hit chain validation. |
| Operator writes a "temporary" backfill that bypasses the writer | Same trigger. Plus: every migration goes through review; reviewer is responsible for checking for tenant_id direct sets. |
| Operator emergency-bypass by ALTER TABLE DISABLE TRIGGER | Per-table alert + RBAC + audit log. Trigger-disable is itself a P1 event. |

No procedural control alone is sufficient. The trigger is the only structural enforcement.

---

## §6 — Adversarial Tenant Simulation

**Tenant A = CRT (Critical Risk Team)**
**Tenant B = PETRONAS (Petronas Canada, LNG, BC operations)**

Walking each write/read surface for leakage points. Each row identifies:
- **Direction:** which tenant's data leaks where
- **Vector:** how the leak occurs
- **Detected by v2?** yes/no/silent

### Signal creation

| Vector | Leakage | Detected by v2? |
|---|---|---|
| Edge function `ingest-signal` writes a signal with `client_id` belonging to CRT but the writer accidentally derives tenant_id from a CRT-shared workspace that points to a PETRONAS-owned investigation | PETRONAS data appears in CRT's signal feed | Silent — no chain-check on `signals` |
| Service-role agent operating in CRT context creates a signal but Path B resolves to PETRONAS via a misowned investigation | Cross-tenant signal | Silent |

*Note:* Option C v2 doesn't touch `signals`. But the chain pattern, if it spreads, would expose the same defect across every table.

### Source creation

| Vector | Leakage | Detected by v2? |
|---|---|---|
| Sources are tenant-scoped via existing client_id. Not affected by v2 directly. | n/a for v2 | n/a |

*Risk:* If a future migration adds workspace_id to sources, the same chain risk applies.

### Entity creation

| Vector | Leakage | Detected by v2? |
|---|---|---|
| An entity created within a multi-tenant investigation_workspace inherits derived tenant via the same chain (if entities ever adopt this pattern) | Cross-tenant entity ownership | Silent |
| The Aegis chat's `create_entity` tool runs under service-role; if it derives via chain it's exposed to the same disagreement risk | Cross-tenant entity created via chat | Silent |

### Investigation creation

| Vector | Leakage | Detected by v2? |
|---|---|---|
| If `investigation_workspaces` is created with `incident_id` from CRT and `investigation_id` from PETRONAS (both populated, data-integrity defect), every subsequent cop_timeline_events row on that workspace stamps with whichever path COALESCE picks | The workspace itself is multi-tenant; every child surface contaminates | **Silent — F1 directly** |

### Timeline event creation (the C.1 surface)

| Vector | Leakage | Detected by v2? |
|---|---|---|
| CRT operator in Briefing Room UI selects a workspace_id that belongs to PETRONAS (no read RLS prevents this — there are no end-user policies); inserts event; chain resolves PETRONAS tenant; event leaks INTO PETRONAS from a CRT user's action | CRT user's event appears in PETRONAS view | Silent unless the workspace_id picker is itself tenant-scoped (not proposed in v2) |
| Service-role automated process writes a timeline event with the wrong tenant_id directly (bypassing the RPC); Provenance CHECK accepts any non-NULL value | Cross-tenant event with no path verification | **Silent — F3** |
| A workspace is reassigned mid-write; the chain resolves before the FK propagation completes | Cross-tenant event under race conditions | Silent |
| Trigger missing → any of the above succeeds; the design has no "intended tenant" comparison | All silent | **All silent** |

### Report generation

| Vector | Leakage | Detected by v2? |
|---|---|---|
| `generate_fortress_report` for CRT filters cop_timeline_events by tenant_id=CRT. If F5 has occurred (stale denorm), the report includes events that semantically belong to PETRONAS but are stamped CRT | PETRONAS data in CRT report — visible to operators, possibly to external auditors | Silent |
| Report filters by workspace_id instead of tenant_id (F7) | Cross-tenant data in report | Silent unless the report code is audited |

### Aegis chat retrieval

| Vector | Leakage | Detected by v2? |
|---|---|---|
| Aegis tenant-mode retrieval for CRT calls a function that joins cop_timeline_events on workspace_id; pulls events from a PETRONAS-shared workspace | CRT principal sees PETRONAS timeline events | Silent — this is **exactly INC-CTX-CONTAM Class A reincarnated** |
| Aegis Ops cross-tenant retrieval seam is not used; tenant-side code path queries directly | Doctrine violation per Aegis Authority Modes ADR | Silent unless the CI guard from `aegis-tenant-intelligence-retrieval.md` catches the `.from()` call |

### Search

| Vector | Leakage | Detected by v2? |
|---|---|---|
| FTS or vector search over cop_timeline_events without explicit `WHERE tenant_id = $caller_tenant` returns cross-tenant matches | Direct cross-tenant search leak | Silent — service-role bypasses RLS |
| Search ranking weights by recency and accidentally surfaces a stale-denorm event | Stale data leaks under search | Silent |

### Dashboard views

| Vector | Leakage | Detected by v2? |
|---|---|---|
| Realtime subscription in `COPCanvas.tsx` filters by `workspace_id`, not `tenant_id`. A workspace shared across tenants (data defect) emits realtime events to the wrong tenant's UI | Realtime cross-tenant event delivery | Silent |
| Dashboard JOIN query mixes cop_timeline_events with incidents/clients without enforcing tenant alignment | Display-time cross-tenant rows | Silent |

### API endpoints

| Vector | Leakage | Detected by v2? |
|---|---|---|
| Any future REST/GraphQL endpoint that exposes cop_timeline_events must enforce tenant scope. v2 doesn't propose any; future endpoints inherit the burden of getting tenant filter right | Endpoint-by-endpoint risk | Silent |
| The Supabase auto-generated REST API exposes cop_timeline_events; RLS is "service-role manage only" → anonymous/authenticated reads return 0 rows (good), but service-role keys are widely distributed in edge functions, increasing surface | Any service-role-using function is a potential reader | Silent |

### Background processing

| Vector | Leakage | Detected by v2? |
|---|---|---|
| `agent-chat`, `auto-orchestrator`, `ai-decision-engine`, `agent-dispatch-investigation` — all run service-role and may write cop_timeline_events. None has proposed tenant-discipline retrofit in v2 | Every background job is a potential cross-tenant writer | Silent |
| Cron-scheduled functions that operate "for all tenants" iterate and may use cached workspace_ids; if a workspace has been reassigned, the cached id resolves to a now-different tenant | Cron drift | Silent |

### Notification delivery

| Vector | Leakage | Detected by v2? |
|---|---|---|
| If timeline events trigger notifications, the notification target is derived from `tenant_id`; if F5 (stale denorm) has occurred, the notification goes to the wrong tenant's recipients | Cross-tenant notification | Silent unless notification audit catches it |

**Total adversarial surfaces enumerated: 24 vectors.** All silent unless detective controls (none proposed in v2) are added. **None** are prevented at the schema layer beyond the NOT NULL constraint.

---

## §7 — Verification Strategy

**Proof, not confidence.** Each control is automated, runs in CI or continuously in prod, and produces a failable signal.

### Unit tests

| Test | Asserts | Where it lives |
|---|---|---|
| `get_workspace_tenant_id` returns Path A when only incident_id populated | Path A correctness | DB test (`pgTAP` or equivalent) |
| `get_workspace_tenant_id` returns Path B when only investigation_id populated | Path B correctness | DB test |
| `get_workspace_tenant_id` returns NULL when both NULL | Fail-closed for empty workspace | DB test |
| `get_workspace_tenant_id` raises EXCEPTION when Path A and Path B disagree | **Disagreement detection** (new requirement) | DB test |
| `get_workspace_tenant_id` returns NULL when `incidents.tenant_id` is NULL | Honest NULL propagation | DB test |
| Direct INSERT with mismatched tenant_id is rejected by trigger | **Trigger enforcement** (new requirement) | DB test |

### Integration tests

| Test | Asserts | Where it lives |
|---|---|---|
| Writer plumb correctly derives tenant_id under matching workspace | E2E correctness | Frontend + DB test |
| Writer plumb rejects insert when workspace has no resolvable tenant | E2E fail-closed | Frontend + DB test |
| Service-role caller cannot spoof tenant_id past trigger | **Trigger enforcement under service-role** | DB test |
| Realtime subscription filters by tenant_id, not workspace_id | Notification scope | Frontend integration test |

### RLS tests

| Test | Asserts | Where it lives |
|---|---|---|
| Anonymous read returns 0 rows | RLS denies anon | Standard RLS test |
| Authenticated user (Tenant A) cannot read Tenant B's cop_timeline_events via direct query | Tenant isolation under authenticated client | RLS test fixture |
| Service-role manage policy allows write but **WITH CHECK trigger** still enforces chain | Defense in depth | RLS test fixture |
| Operator (super_admin) read works | Diagnostic access preserved | RLS test fixture |

### Cross-tenant contamination tests

| Test | Asserts | Where it lives |
|---|---|---|
| **`test_no_workspace_spans_tenants`** — for every `investigation_workspaces` row where both `incident_id` and `investigation_id` are populated, the resolved tenants must match | Multi-parent consistency | Continuous prod audit + CI |
| **`test_no_stale_denorm`** — every `cop_timeline_events` row's tenant_id equals `get_workspace_tenant_id(workspace_id)` recomputed now | No drift after parent mutations | Continuous prod audit |
| **`test_no_null_in_table`** — every cop_timeline_events row has non-NULL tenant_id | Constraint integrity | Continuous prod audit |
| **`test_writer_chain_match`** — sample N writes; assert each row's tenant_id matches the RPC's recomputation | Writer correctness | CI + continuous |
| **`test_adversarial_writer`** — fixture writer attempts direct INSERT with mismatched tenant_id; assert rejection | **Trigger backstop** | Test suite (CI) |

### Migration validation tests

| Test | Asserts | Where it lives |
|---|---|---|
| Pre-migration: snapshot row counts on cop_timeline_events / investigation_workspaces / incidents / investigations / clients | Baseline | Migration |
| Post-migration: row counts identical | No silent data loss | Migration |
| Post-migration: 100% of cop_timeline_events rows have non-NULL tenant_id | Backfill complete | Migration |
| Post-migration: 100% of rows' tenant_id matches `get_workspace_tenant_id(workspace_id)` | Backfill consistent | Migration |
| Post-migration: SELECT COUNT (*) FROM cop_timeline_events WHERE workspace_id IS NULL — must be 0 | Workspace required | Migration |

### Production monitoring

| Monitor | Frequency | Alert threshold |
|---|---|---|
| Stale-denorm row count | Every 15 min | >0 rows → P1 |
| Two-path disagreement count on investigation_workspaces | Every 15 min | >0 → P1 |
| NULL tenant_id in cop_timeline_events (constraint violation) | Continuous | Any → P1 |
| Trigger disabled state | Continuous | Any → P0 |
| RLS policy change on cop_timeline_events | Continuous (via DB audit log) | Any unexpected change → P1 |
| Service-role direct INSERTs that bypass the RPC | Daily audit | >0 unaccounted-for → investigate |

### Continuous audit controls

| Control | Mechanism |
|---|---|
| **Tenant-isolation drift audit** | Nightly `aegis_decision_threshold_trace`-style audit table that records any drift between stored tenant_id and computed tenant_id |
| **Workspace-tenant-consistency audit** | Nightly job that scans `investigation_workspaces` for multi-parent disagreements |
| **Writer-discipline audit** | Static scan of `supabase/functions/**` for `cop_timeline_events` writes that don't go through the canonical helper |
| **Trigger-state audit** | Hourly check that the chain-enforcement trigger is ENABLED |

### CI/CD gates

| Gate | Blocks merge on |
|---|---|
| Static grep guard | Any `cop_timeline_events` `.insert()` or `.upsert()` outside the shared writer helper |
| `pgTAP` chain tests | Any failure |
| RLS regression suite | Any failure |
| Schema drift detection | Migration changes that affect any chain hop without updating the canonical resolver |
| Migration plan review | Any migration that touches `incidents.tenant_id`, `investigations.client_id`, `clients.tenant_id`, or any chain hop is flagged for security review |

---

## §8 — Long-Term Architecture Review

### Can this architecture support PETRONAS, CRT, BC Place, future enterprise tenants, hundreds of tenants?

**No, not as designed.** The chain-derivation pattern has three structural scaling problems:

1. **Every new table that hangs off `investigation_workspaces` reimplements the chain.** Today it's cop_timeline_events. Tomorrow it could be `workspace_notes`, `workspace_attachments`, `workspace_decisions` (an actual future surface for the Decision Layer!). Each will need: (a) the same chain-derivation, (b) the same backfill, (c) the same writer plumb, (d) the same trigger if we add one. **Linear cost per new table.** With hundreds of tenants, the per-table integration cost dominates.

2. **The chain doesn't compose.** If a future workspace can be parented to *another workspace* (nested investigations, hierarchical incident response), the chain length grows. No place in the design accommodates this.

3. **The chain is fragile across schema evolution.** Every change to `incidents`, `investigations`, `clients` is a chance to break tenant resolution silently. At one tenant or three, occasional review catches drift. At hundreds, the audit surface dominates the engineering time.

### Stronger architecture (proposed, not authorized)

**Option β-revisited: promote `tenant_id` to `investigation_workspaces.tenant_id` (NOT NULL).**

```
investigation_workspaces
  + tenant_id uuid NOT NULL
  + CONSTRAINT investigation_workspaces_provenance_ck CHECK (tenant_id IS NOT NULL)
  + CONSTRAINT investigation_workspaces_tenant_consistency_ck
    CHECK (
      tenant_id = COALESCE(
        (SELECT i.tenant_id FROM incidents i WHERE i.id = incident_id),
        (SELECT c.tenant_id FROM clients c JOIN investigations inv ON inv.client_id = c.id WHERE inv.id = investigation_id),
        tenant_id  -- if no parent path, accept the explicit set
      )
    )
```

Then `cop_timeline_events.tenant_id` is one-hop: `tenant_id = (SELECT tenant_id FROM investigation_workspaces WHERE id = workspace_id)`. A simple trigger enforces it. The chain logic exists once, in `investigation_workspaces`'s consistency CHECK, not duplicated across every child table.

**Architectural benefits:**
- **Single source of truth for workspace tenancy.** Every child table joins one hop.
- **The chain logic lives in `investigation_workspaces`'s consistency check** — one place to audit.
- **Future child tables inherit the discipline for free.**
- **Schema evolution is bounded:** changes to incidents/investigations/clients only need to update the consistency check, not every child writer.
- **The "two paths disagree" failure mode is structurally impossible** — the consistency check rejects the parent row, not the child row.
- **Tenant migration becomes possible without sweeping every child** — update `investigation_workspaces.tenant_id` once; the child JOIN-on-write picks up the new value via a trigger.

**Architectural costs:**
- One extra phase (call it C.0).
- Backfill of `investigation_workspaces.tenant_id` via the same `COALESCE` chain — but only **once**, at one table.
- One existing surface (`COPCanvas.tsx:178`) needs to be updated to fetch tenant_id from the workspace, not the chain.

The operator's earlier rejection of Option β was "do not introduce C.0" — but that decision was made **before** the schema-reality pre-flight surfaced that the chain isn't actually a 1-hop denorm (which the v1 ADR implied) but a multi-hop derivation across a nullable junction table. **The cost-benefit changes once you see the actual schema.**

### What the architecture looks like at hundreds of tenants

If C.1 v2 (chain in every child) ships: at each table, at each new feature, at each schema change, the team re-faces the same tenant-derivation question. Drift is inevitable. Detection is mandatory. Engineering cost scales linearly with tenant-touching surface count.

If Option β (workspace.tenant_id) ships: workspace tenancy is established once. Every child table is one-hop. The audit surface is `investigation_workspaces`'s own consistency check + the per-child trigger.

**At one tenant the difference is nothing. At ten tenants it's manageable either way. At one hundred tenants the chain pattern accrues drift faster than audits can catch it.**

---

## §9 — Approval Recommendation

### Critical Risks (existential or severe + silent)

| # | Risk | Section |
|---|---|---|
| CR1 | F3: Service-role spoofing of tenant_id; CHECK only enforces NOT NULL | §2 |
| CR2 | F1: Two-path COALESCE disagreement silently picks wrong tenant | §2 |
| CR3 | F5: Denormalization stales on parent mutation; no propagation | §2 |
| CR4 | F7: Aegis retrieval pipelines may still query workspace-scoped (INC-CTX-CONTAM class) | §2 |
| CR5 | F10: Tenant migration mis-syncs children; existential at corporate-event scale | §2 |

### Medium Risks (severe but detectable, or contained)

| # | Risk | Section |
|---|---|---|
| MR1 | F2: Path A NULL fallback to Path B silently | §2 |
| MR2 | F6: Background job stale workspace context | §2 |
| MR3 | F8: Future schema change breaks chain silently | §2 |
| MR4 | F9: Backup restore creates parent-child inconsistency | §2 |
| MR5 | Aegis tenant-mode read-paths inherit the chain weakness | §6 |

### Required Controls Before Approval (the five named gaps)

| # | Control | Why |
|---|---|---|
| **RC1** | **Trigger enforcement** on `cop_timeline_events` BEFORE INSERT/UPDATE that rejects rows where the provided `tenant_id` doesn't match `get_workspace_tenant_id(workspace_id)` | Closes F3 (spoofing), F6 (stale workspace context), partially F1 (if RPC raises on disagreement) |
| **RC2** | **`get_workspace_tenant_id` raises EXCEPTION on Path A / Path B disagreement** (not silent COALESCE) | Closes F1 |
| **RC3** | **Continuous drift audit** — periodic SQL job that scans for `tenant_id != get_workspace_tenant_id(workspace_id)`; any row is a P1 incident | Closes F5 (stale denorm) and F4 (RLS bypass writers) |
| **RC4** | **CI static-grep guard** on `supabase/functions/**` blocking any `cop_timeline_events` write outside the canonical writer helper | Closes F3 at the source-code level |
| **RC5** | **Reconsider Option β** — promote `tenant_id` to `investigation_workspaces` directly; reduces the chain to one hop and makes every future child surface inherit tenant discipline structurally | Closes the structural-scaling weakness identified in §8; reduces every other CR/MR's severity by half |

RC1–RC4 are mandatory before any C.1 apply. RC5 is strongly recommended; if rejected, the operator should accept a permanent maintenance burden across every future child table of `investigation_workspaces`.

### Recommended Automated Tests (before any C.1 apply)

| # | Test | Type |
|---|---|---|
| AT1 | Trigger rejects mismatched tenant_id (unit) | DB |
| AT2 | RPC raises on Path A / Path B disagreement (unit) | DB |
| AT3 | Adversarial writer fixture: service-role direct INSERT with wrong tenant rejected (integration) | DB + edge function |
| AT4 | Drift detector returns 0 rows in clean state (continuous) | Prod monitor |
| AT5 | Migration validation: post-apply, 100% of rows satisfy `tenant_id = get_workspace_tenant_id(workspace_id)` | Migration |
| AT6 | RLS regression suite covering Tenant A read of Tenant B rows under each role (auth, anon, service, super_admin) | Test fixture |
| AT7 | PETRONAS/CRT cross-tenant contamination fixture: assert no row from one tenant leaks into the other across all surfaces in §6 | Integration |
| AT8 | Static-grep CI guard test that fails a sample bad-writer PR | CI |

### Go / No-Go Recommendation

# **NO-GO** for C.1 v2 as currently designed.

The design relies on writer discipline and a NOT NULL constraint. Both have failed in this codebase before (INC-XTEN, INC-CTX-CONTAM, INC-LEARN-CONTAM). The proposed RPC is good ergonomics but cannot be the enforcement layer. The two-path COALESCE introduces a silent disagreement failure mode that no v2 control detects.

**Go conditions** (any subset of these moves the recommendation toward GO):

| Path | What it adds | Outcome |
|---|---|---|
| **Path G1 (minimum):** Add RC1 (trigger) + RC2 (raise on disagreement) + RC3 (drift audit) + RC4 (CI guard) | Closes the critical writer-discipline gap; converts silent failures to loud failures | Conditional GO for C.1 v2 |
| **Path G2 (strong):** All of G1 + adopt Option β (promote tenant_id to investigation_workspaces) | Closes the structural scaling gap; reduces all future child-table-tenant issues to a single hop | Strong GO; recommended for long-term operations at >10 tenants |
| **Path G3 (acceptable but weaker):** G1 only, defer Option β to a future ADR | GO for C.1 v2 in the short term; you inherit linear scaling cost on every future child surface | Acceptable if the operator accepts the long-term cost |

**If none of G1/G2/G3 is added: NO-GO.** Proceeding without enforcement and drift detection is structurally equivalent to past tenant-isolation incidents.

### Operator decision matrix

| Operator wants | Operator should authorize |
|---|---|
| Ship C.1 ASAP, accept long-term technical debt | G3 (G1 controls + defer β) |
| Ship correctly the first time, smallest schema patch set | G1 (mandatory controls, no β) |
| Build for hundreds of tenants without per-table drift audits | **G2 (G1 + β)** — strongest recommendation |
| Refuse to add enforcement layers | **NO-GO**; revisit Options B / D / E |

The security architect's recommendation is **G2**. If G2 is rejected, the operator should at minimum require G1 before any C.1 apply.

---

## §10 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- R1.0 (deployed) — unaffected
- **R1.1 — still NOT authorized; §8 inventory-rerun gate stands**
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged

This review proposes NO changes to any of the above. It proposes that **C.1 v2 not be authorized as currently designed** and names the five controls required to convert it from NO-GO to conditional GO.

## Changelog

- **2026-05-30 v1** — initial ruthless security review. 10 named failure modes, 24 adversarial PETRONAS/CRT vectors, 11 brittle assumptions, 5 critical risks, 5 medium risks, 5 required controls (trigger + raise-on-disagreement + drift audit + CI guard + Option β reconsideration), 8 recommended automated tests, 3-path go-conditions matrix. Recommendation: **NO-GO unless minimum Path G1 controls are added; strong recommendation Path G2 with Option β reconsidered.**
