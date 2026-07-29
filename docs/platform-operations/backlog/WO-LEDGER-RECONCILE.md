# WO-LEDGER-RECONCILE — repo-wide migration-ledger reconciliation

**Raised:** 2026-07-29 (PR-triage session — surfaced by the schema_migrations baseline dry-run).
**Blocks:** `supabase db push` / any bulk migration apply against prod (see the Migration-Apply Prohibition Standing Rule in CLAUDE.md).

## The finding

The prod migration ledger (`supabase_migrations.schema_migrations`) has diverged from the committed
migration filenames. A `db push` dry-run equivalent — every local `<version>_<name>.sql` version
`EXCEPT` the prod ledger versions — returns **120 files** that `db push` would attempt to apply:

- Root cause: the repo's standard workflow applies migrations via MCP `apply_migration` /
  `execute_sql`, which records a **generated** version (e.g. `20260729182252`) and sometimes a
  **different name** than the committed `<version>_<name>.sql` file (e.g. file
  `20260729170000_registry_phantom_hygiene.sql` was applied as ledger row
  `20260729182252 / registry_phantom_check_fn_v2`). So git and the ledger diverge in **both**
  version and name.
- The content of the 120 is **live in prod** — identifier-divergence, NOT unapplied work.
  Spot-verified 2026-07-29: `travel_itineraries`/personal-travel tables, `platform_findings`,
  3× `trg_inc_learn_contam_*` freeze triggers, job-worker lease routines, `incidents.superseded_*`,
  `alert_emission_refusals`, `signals` confidence-range CHECKs — all present.
- Consequence: `db push` would try to re-run all 120, most non-idempotent (bare `create table` /
  `add column` / `create trigger`) → error / state corruption.

## Evidence (2026-07-29 baseline report)

- Local migration files (main): **511**.
- Ledger `EXCEPT` diff — `would_apply_count`: **120**.
- 6-file salvage debt (PR #183): CLOSED — `my6_still_missing = 0` after baselining
  `20260529180000 / 210000 / 220000`, `20260530120000 / 140000 / 160000`.
- The 120 span ~`20260502*` → `20260729*` (everything applied via the apply_migration workflow era).

## The sweep

Repo-wide extension of the 6-file baseline: for each of the 120 committed migration files whose
version is absent from the ledger, **confirm its content is live in prod** (object existence /
schema-diff, not trust), then **baseline its version into `schema_migrations`** (same insert idiom
as the 6: version + name + provenance-marker `statements` + `created_by`). Where a file's content
is genuinely NOT live (if any), that is a real pending migration — apply it via the CLI-direct
single-file path, do not bulk-push.

Acceptance: after the sweep, the `local EXCEPT ledger` diff returns **0** (or only a documented,
justified remainder), and a `db push` dry-run against prod reports nothing-to-apply. Only then is
the Migration-Apply Prohibition lifted.

## Until then

Any migration reaching prod goes via the existing **CLI-direct single-file** path only
(`apply_migration` one file / established per-file apply). **No `db push`, no bulk apply.**
