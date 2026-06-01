# ER v1 Substrate — Staging Validation Report

**Date:** 2026-06-01
**Branch:** `feat/er-v1-actor-clusters-substrate`
**Commit:** `16a9f7a0`
**Migration:** `20260601131544_er_v1_actor_clusters_substrate.sql`
**Staging project:** `lkvyrvuakzguszbpwnfz`
**Apply timestamp:** 2026-06-01 (post-1315Z)
**Design ref:** `docs/platform-operations/entity-resolution-v1-design-2026-06-01.md`
**Operator authorization:** GO 2026-06-01 (D1-D6 approved); execution pattern: substrate-first → staging → operator usefulness → prod.

## Scope (what shipped)

- `public.actor_clusters` — 8 columns
- `public.actor_cluster_members` — 7 columns
- 1 trigger function `actor_cluster_member_tenant_match()` + BEFORE INSERT/UPDATE trigger
- 9 indexes (incl. PKs and UNIQUE)
- RLS ENABLED on both tables + 2 SELECT policies (tenant-scoped via `tenant_users`)
- 0 writers, 0 readers, 0 Aegis integration — substrate alone

## Behavioral change at apply time

**Zero.** Capability Registry status remains `NOT_OPERATIONAL` until the writer/reader slice ships.

## §1 — Schema present

Both tables created with all expected columns, types, nullability, and defaults. ✅

## §2 — Constraints (10 total) — all present

| Constraint | Definition | Status |
|---|---|---|
| `actor_clusters_pkey` | PRIMARY KEY (id) | ✅ |
| `actor_clusters_tenant_id_fkey` | FK → tenants(id) ON DELETE CASCADE | ✅ |
| `actor_clusters_resolved_by_user_id_fkey` | FK → auth.users(id) | ✅ |
| `actor_clusters_status_check` | status IN (suggested\|confirmed\|rejected\|superseded) | ✅ |
| `actor_clusters_resolved_consistency_check` | suggested↔NULL resolved_*; resolved↔NOT NULL resolved_at | ✅ |
| `actor_cluster_members_pkey` | PRIMARY KEY (id) | ✅ |
| `actor_cluster_members_cluster_id_fkey` | FK → actor_clusters(id) ON DELETE CASCADE | ✅ |
| `actor_cluster_members_entity_id_fkey` | FK → entities(id) ON DELETE CASCADE | ✅ |
| `actor_cluster_members_role_check` | role IN (anchor\|candidate) | ✅ |
| `actor_cluster_members_cluster_entity_unique` | UNIQUE (cluster_id, entity_id) | ✅ |

## §3 — Indexes (9 total) — all present

Tenant lookup, (tenant, status), (tenant, created DESC), cluster, entity, (cluster, first_seen) — plus the 2 PKs and 1 UNIQUE.

## §4 — RLS + trigger — all present

- `actor_clusters` — `rowsecurity=true`; policy `actor_clusters_select_tenant` (SELECT/authenticated) scopes via `tenant_users` linkage.
- `actor_cluster_members` — `rowsecurity=true`; policy `actor_cluster_members_select_tenant` (SELECT/authenticated) scopes via parent cluster's tenant.
- INSERT/UPDATE/DELETE intentionally NOT exposed via RLS — service-role-only writes until writer slice ships.
- `trg_actor_cluster_members_tenant_match` — BEFORE INSERT OR UPDATE OF cluster_id, entity_id; fires `actor_cluster_member_tenant_match()`.

## §5 — Constraint enforcement tests (5 negative-control inserts) — **all PASS with SQLSTATE 23514**

| # | Test | SQLSTATE | Notes |
|---|---|---|---|
| 1 | INSERT cluster with `status='invalid_status'` | 23514 | status CHECK enforced |
| 2 | INSERT cluster with `status='suggested'` + `resolved_at=now()` | 23514 | resolved_consistency CHECK enforced |
| 3 | INSERT member with `role='invalid_role'` | 23514 | role CHECK enforced |
| 4 | INSERT member referencing entity with NULL `tenant_id` | 23514 | Trigger rejected: *"refers to entity with NULL tenant_id (Provenance Doctrine violation)"* |
| 5 | INSERT member where cluster.tenant_id ≠ entity.tenant_id | 23514 | Trigger rejected: *"tenant mismatch: cluster tenant_id=4f28617d… but entity tenant_id=79315dca… (Aegis Authority + Memory: cross-tenant clustering forbidden)"* |

Positive control: a single valid cluster insert succeeded; it was deleted at end of block. Post-test: both tables contain 0 rows.

## §6 — Clean state confirmed

```
clusters_count = 0
members_count  = 0
```

## §7 — Rollback drill — **PASS**

A DO block dropped both tables + trigger function with CASCADE, then `RAISE EXCEPTION` forced an auto-rollback. Post-drill verification:

```
tables_present  = 2
fn_present      = 1
trigger_present = 1
```

Confirms the substrate is fully reversible. If prod apply ever needs an emergency rollback, the script:

```sql
DROP TABLE IF EXISTS public.actor_cluster_members CASCADE;
DROP TABLE IF EXISTS public.actor_clusters CASCADE;
DROP FUNCTION IF EXISTS public.actor_cluster_member_tenant_match() CASCADE;
```

…works cleanly in a single transaction.

## §8 — Rework-test invariants confirmed locked

| Invariant | Realized by | Cycling-rebuild risk |
|---|---|---|
| N-way membership | `actor_cluster_members` many-to-one with `actor_clusters` (not a self-join) | eliminated |
| Time axis on members | `first_seen_at NOT NULL` timestamptz | eliminated |
| Per-axis evidence | `axes_evidence jsonb NOT NULL DEFAULT '{}'` | eliminated |
| Operator confirmation state | `status` lifecycle + `resolved_at` + `resolved_by_user_id` + `resolution_note` | eliminated |
| Tenant ownership | non-NULL `tenant_id` + tenant-match trigger (cross-tenant + NULL-ownerless both rejected) | eliminated |
| Referential integrity | FK cascade from clusters→members→entities | eliminated |

## §9 — Out of scope for this slice (sequenced after operator GO)

- Writer code (autonomous clustering jobs, suggestion generators)
- Reader code (Aegis chat surface, capability registry status flip)
- D5 modification: useful-insight metric (instrumented later)
- T+1h watch — staging has no downstream consumers; T+1h applies post-prod-apply only.

## Status (staging)

**Staging validation: COMPLETE — GREEN across §1–§7.**

Substrate is correct, enforced, and reversible.

---

## §10 — Production application (2026-06-01)

**Operator GO recorded 2026-06-01** — operator decision: *"APPROVE production application of migration 20260601131544_er_v1_actor_clusters_substrate."* Constraints: no writer/reader/Aegis integration, no Capability Registry change.

**Apply timestamp (prod):** `2026-06-01T14:11:10Z`
**Prod project:** `kpuqukppbmwebiptqmog`
**Method:** MCP `apply_migration` with byte-identical SQL (only header comments differ from staging — substantive DDL is identical).

### §10.1 — Prod schema parity

| Check | Staging | Prod | Match |
|---|---|---|---|
| `actor_clusters` columns | 8 | 8 | ✅ |
| `actor_cluster_members` columns | 7 | 7 | ✅ |
| Constraints (PK+FK+CHECK+UNIQUE) | 10 | 10 | ✅ |
| Indexes (incl. PK + UNIQUE) | 9 | 9 | ✅ |
| RLS-enabled tables | 2 | 2 | ✅ |
| SELECT policies | 2 | 2 | ✅ |
| Triggers (non-internal) | 1 | 1 | ✅ |

### §10.2 — Prod constraint enforcement (5/5 PASS, SQLSTATE 23514)

| # | Test | Result |
|---|---|---|
| 1 | INSERT cluster `status='invalid_status'` | PASS — rejected |
| 2 | INSERT cluster `suggested` + `resolved_at=now()` | PASS — rejected |
| 3 | INSERT member `role='invalid_role'` | PASS — rejected |
| 4 | INSERT member referencing entity with NULL `tenant_id` (entity `2f01018f-…`) | PASS — *"refers to entity with NULL tenant_id (Provenance Doctrine violation)"* |
| 5 | INSERT member where cluster.tenant_id (CRT) ≠ entity.tenant_id (Silent Shield Ops) | PASS — *"tenant mismatch: cluster tenant_id=0aaaaaaa-… but entity tenant_id=feff5c44-… (Aegis Authority + Memory: cross-tenant clustering forbidden)"* |

### §10.3 — Prod clean state

```
clusters_count = 0
members_count  = 0
```

No row debris from positive control or negative tests.

### §10.4 — Prod rollback drill — PASS

Same DROP CASCADE + RAISE pattern as staging. Post-drill:

```
tables_present  = 2
fn_present      = 1
trigger_present = 1
policies_present = 2
```

Substrate fully reversible in prod.

### §10.5 — Side-finding (pre-existing; not introduced by this migration)

Prod probe surfaced **74 entities with NULL `tenant_id`** — pre-existing INC-XTEN-class data (sibling of task #19 / #53). The tenant-match trigger correctly fail-closes against this surface (Test 4 above used one of these as the probe entity). No remediation action triggered by this slice; surfaced for separate triage under INC-XTEN sibling sweep.

### §10.6 — T+1h watch — **GREEN** (fired 2026-06-01T16:49Z via background task `b6v1gun8w`)

Watch ran approximately 2h38m after apply (apply 14:11:10Z → watch 16:49:52Z; overshoot due to in-flight Slice 2 validation work in parallel).

| Check | T+0 | T+1h | Status |
|---|---|---|---|
| `actor_clusters` count | 0 | 0 | ✅ no rogue writer |
| `actor_cluster_members` count | 0 | 0 | ✅ no rogue writer |
| Tables present | 2 | 2 | ✅ schema stable |
| Constraints | 10 | 10 | ✅ stable |
| Indexes | 9 | 9 | ✅ stable |
| RLS policies | 2 | 2 | ✅ stable |
| Trigger present | 1 | 1 | ✅ stable |

Substrate prod workstream is **CLOSED** (task #180). Slice 2 + Slice 3+ work continues separately.

## Status (prod)

**Prod validation: COMPLETE — GREEN across §10.1–§10.5.** T+1h watch pending.

---

## What ships next (gated)

- No writer/reader implementation in this slice.
- No Capability Registry status change in this slice.
- No autonomous clustering in this slice.
- Any v1 scope expansion remains gated behind a separate work proposal per established discipline.

Next operator-gated step: writer slice work proposal (clustering candidate generation) — separate authorization required.
