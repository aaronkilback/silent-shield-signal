# Browser Signal Filter Boundary

| Field | Value |
| --- | --- |
| Class | B — Source containment |
| State | **READY — source-only, release-blocked** |
| Priority | P1 |
| Owner | Aaron |
| Decision owner | Aaron |
| Environment in scope | Source only |
| Production | Explicitly excluded |

## Scope

Removal of the browser-bundled `service_role` role and branch from `src/lib/signal-query-filters.ts`.

## What changed

- Browser roles are now `analyst` and `operator` only.
- `analyst` retains `quality_status = active`.
- `operator` retains unchanged-query behavior.
- Tenant/client predicates were untouched.

## Evidence

- Focused Vitest suite passed: 5 tests.
- Critical File Guard grep passed with no `service_role` literal under guarded frontend paths.
- `npx tsc --noEmit` passed.
- Claude approved the two-file repair.

## What this does not prove

- No deployment or runtime behavior.
- No server-side/RLS enforcement.
- No tenant/client isolation proof.
- No resolution of ESLint or E2E baseline failures.

## Release gate

PR #96 remains unmerged until delivery-lane certification and a separate release decision.

## Stale-proof triggers

Treat this card as stale if the filter module, Critical File Guard, frontend delivery workflow, or role-origin paths change.
