# WO-GUARD-NAMING-SWEEP-01 — Filters that read as safety guards but are not

**Status:** LOGGED, not started. Awaiting operator prioritization.
**Class:** naming / false-assurance defect (not a missing-filter defect). The dangerous kind — a predicate that *looks* like a guard, so reviewers stop looking.
**Provenance:** Q2 sweep, 2026-08-13. `quality_status = 'active'` was read across the codebase as if it excluded test data. It does not — a test signal can be `quality_status='active'` (verified: Cascade Energy fixture, 501 active `is_test=true` signals; sample `173e729b…` is admitted by `quality_status='active'` and excluded only by `excludeTestAndDeleted`). So ~several signal reads marked "guarded" by the sweep were unguarded against `is_test`.

## The finding
This is the **same shape as the `surface_date` defect**: a field/predicate whose name implies a safety property it does not enforce. `quality_status='active'` reads as "clean, live data" and is treated as a test/deleted guard in review — but it is orthogonal to `is_test` and only partially overlaps `deleted_at`. A filter that reads as a guard and is not one is worse than no filter, because it stops the reviewer from adding the real one.

## Scope (sweep, then classify — do NOT bulk-edit)
1. **Enumerate predicates that read as guards.** Candidates: `quality_status='active'`, `status='active'`, `status IN (...)`, `is_read`, `is_stale=false`, any `*_status`/`is_*` flag used as a proxy for "safe to show a client." For each, state what it *actually* excludes vs. what a reader would *assume* it excludes.
2. **Find every read that relies on the assumed-but-absent property.** Especially: reads guarded ONLY by `quality_status='active'` that reach a client-facing answer (the Q2 sweep left these uncounted — they are the immediate follow-on to the 7 Rank-1 sites already fixed with `excludeTestAndDeleted`).
3. **Rank by client-facing reachability** (same rubric as the Q2 classification).

## Acceptance criterion (single)
A documented table of "guard-shaped predicates" — name, what it truly excludes, the false assumption it invites — plus the list of client-facing reads relying on a false guard, ranked. No edits in this WO; it produces the classified list the next fix-WO acts on.

## Related
- Q2 sweep + `excludeTestAndDeleted` (the 7 Rank-1 fixes that exposed this).
- `surface_date` (the original "field named like a guarantee it doesn't make").
- [[feedback-negative-finding-needs-complete-search]] — a predicate assumed to cover a case it doesn't is the same incomplete-coverage error, on the guard side.
- INC-CTX-CONTAM §4 "carries no tenant facts" — a scoping assumption that was false; this is its filter-naming twin.
