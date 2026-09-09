# WO-STRANDED-DOCS-SWEEP — ~30 branches carry platform-ops docs never merged to main

**Status:** OPEN — report only (surfaced 2026-09-07 while rescuing `WO-PROPOSAL-QUEUE-AGING`). Do NOT bulk-
merge; triage.

## The finding
A one-query sweep — every `docs/platform-operations/**` file present on any branch but absent from
`origin/main` — returned **~30 branches** carrying doc/WO/incident/architecture-decision files that never
landed on main. The canonical backlog on `main` is therefore an **undercount**: work orders, authorization
packages, runbooks, and incident records exist in git history but not where anyone reads them. Same class as
`WO-PROPOSAL-QUEUE-AGING` (authored 09-01, reached main only 09-07) — a promise no one can see. Registry-is-a-
Promise / Parked-PR-Re-Triage applied to the doc tree.

## Representative clusters (not exhaustive)
- **`fix/wo-entity-mention-contamination`** (`cbd6270b`, this session's base): `WO-ENTITY-MENTION-CONTAMINATION`,
  `WO-ENTITY-PROVENANCE-GAP`, `WO-TEST-DATA-ISOLATION`, `WO-WILDFIRE-IGNITION-TIER`,
  `WO-CORRELATE-SIGNALS-TENANT-SCOPE`, `WO-PRODEE-FOLLOWUP-COMPLETE` (the last two are the specs for the
  still-pending Tasks 5 & 6).
- **`feat/anon-surface-hardening` / `fix/postgrest-embed-silent-failures`**: ~18 docs incl.
  `containment-registry.md`, `fail-loud-doctrine.md`, `WO-CHILD-SAFETY-SECTION6`, `WO-UNSCOPED-READ-CLASSIFIER-01`,
  `INC-GEO-ANON-EXPOSURE-2026-08-11`, `WO-WORM-LOCK-EXTEND`.
- **temporal-integrity / decision-layer / classA / capability-registry / er-v1** (May–June 2026): dozens of
  authorization packages, validations, runbooks, and architecture-decisions across ~15 branches.
- **`voice-tool-executor-v2-staging-containment.md`**: present on ~10 staging/reliability branches, not main.

## What to do (later — report only)
Triage each stranded doc, same shape as PR re-triage: **RESCUE** (still-live WO/incident → cherry-pick to main),
**SUPERSEDED** (landed elsewhere or overtaken → archive with a one-line header), or **STALE** (obsolete lane →
drop). Do NOT bulk-merge branches (they also carry code). Prioritize: **incident records** and **containment/
registry docs** first (safety-relevant, must be discoverable on main), then live WOs, then design/validation
packages. `containment-registry.md` being off-main is its own hazard — a containment ledger no one can see.

## Cross-refs
`WO-PROPOSAL-QUEUE-AGING` (the trigger instance), Parked-PR Re-Triage + Registry-is-a-Promise standing rules,
`WO-LEDGER-RECONCILE` (the migration-ledger twin of this — divergence between what's recorded and what's real).
