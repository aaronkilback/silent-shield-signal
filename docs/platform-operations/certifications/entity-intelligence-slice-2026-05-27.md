# Certification Proof — Entity Intelligence Slice (2026-05-27)

First certified surfaces + edges under the Unified Retrieval & Intelligence Graph. Implemented in `supabase/functions/_shared/tenant-entity-graph.ts`; raw `search_entities`/`search_signals_by_entity` retired to delegate here. **Staging-validated; prod read-only parity verified; NOT yet prod-deployed.**

## Certified NODE surface
| Surface | Scope key | Pattern | Status |
|---|---|---|---|
| `entities` | `tenant_id` | direct | **CERTIFIED** |

## Certified EDGES
| Edge | Linkage | Scope | Status |
|---|---|---|---|
| entity→signals (correlated) | `entity_mentions` ∪ `signals.auto_correlated_entities` | `signals.tenant_id` | **CERTIFIED** |
| entity→client→signals (uncorrelated context) | `signals.client_id = entity.client_id`, EXCLUDING correlated | `signals.tenant_id` | **CERTIFIED** ((c) semantics, reported separately) |
| entity↔entity | `entity_relationships` (both endpoints in-tenant) | edge-join | **CERTIFIED** |

## Isolation proofs (empirical)
**Prod read-only (CRT / Trent Reznor) — replicating the module's exact queries:**
- `entityIntelligence(CRT)` → total **62**, monitored **15**, unreviewed **0**.
- `entitySignals(CRT,'trent')` → resolves 1 entity; **correlated = 0**; **client-context uncorrelated = 11** (the (c) shape; matches UI).
- Isolation: rows in the CRT-scoped query belonging to another tenant = **0**; `Petronas Canada` present in CRT entity set = **0**.

**Staging (cross-tenant probe):**
- `Critical Risk Team` (staging) entity query → **3** entities; leaks from other tenants = **0**.
- `Petronas Tenant` (staging) → **1**; leak from CRT = **0**.

## Provenance
Every function returns a `Provenance { surface, scope, edges, row_ids, counts, note }` trace. No-trace → no-claim is enforced by the module shape.

## (c) semantics — honest gap
"Signals for Trent Reznor" = **0 directly correlated** + **11 in the Trent Reznor client context, not yet entity-correlated.** No name/title inference; no fabricated edges. The Trent Reznor client has 2 entities (Kelly Pietras + Trent Reznor), so deterministic per-entity attribution of those 11 is impossible without correlation re-run — explicitly **deferred** to a future write-side task.

## Acceptance vs criteria
| Criterion | Result |
|---|---|
| CRT entity count correct | ✅ 62 (logic-proven) |
| Monitored CRT entities correct | ✅ 15 |
| Trent signals consistent with UI | ✅ 0 correlated + 11 client-context |
| No cross-tenant entity/signal leakage | ✅ 0 (prod + staging probes) |
| Every answer has provenance trace | ✅ module returns Provenance |
| Raw search_entities/search_signals_by_entity retired | ✅ delegate to certified module |
| Compilation/deploy | ✅ staging |
| **Live LLM-routing answer (Aegis chooses tool + composes)** | ⏳ **prod live test (operator), post-go** |

**STOPPED before prod deploy, per directive. Pending: operator go for prod deploy + live UI/Aegis confirmation.**
