# WO-SOFTDELETE-INTERNAL-READS — mark/migrate the 445 audit-only internal reads

**Opened:** 2026-08-22 (spun out of WO-LEAK-SWEEP)
**Status:** BACKLOG — do NOT work now (operator ruling 2026-08-22). Logged so the audit-only tail is a
tracked promise, not an unexamined one.

## Context
The leak sweep filtered every **client-facing** read of `signals` / `incidents` / `entities` /
`subject_exposure_items` through the 4 named helpers and promoted `scripts/check-soft-delete-filters.mjs`
to **BLOCKING on client-facing reads** (client-facing count = 0). The gate still reports — but does NOT
block on — the remaining internal reads:

| Table | OTHER (audit-only) reads | Helper |
|---|---|---|
| signals | 250 | excludeDeletedSignals |
| incidents | 92 | excludeDeletedIncidents |
| entities | 103 | excludeMergedEntities |
| subject_exposure_items | 0 | excludeSupersededExposure |
| **Total** | **445** | |

(Counts as of the 2026-08-22 gate run; re-run `node scripts/check-soft-delete-filters.mjs` for current.)

## Scope
Each of the 445 is a read in a non-client-facing path (monitors, ingest/enrichment pipelines,
operator-diagnostic surfaces, internal jobs). For each, apply the four rules (recorded in the gate header
and [[existence-exempt-display-filtered]]) and resolve to ONE of:
1. **Wrap** in the named helper (it is display-by-intent after all, or feeds client output — see risk below).
2. **Mark** `// @soft-delete-exempt: <reason>` naming which case it is (existence check / provenance
   derivation / write-gate / operator-only diagnostic surface / internal learning pipeline).
3. **Migrate** (e.g. an operator-only diagnostic that should carry the `@qa-allow:operator-surface-unfiltered`
   convention from the Quarantine Doctrine).

## The load-bearing question (operator, 2026-08-22): do any internal reads FEED client output?
"Internal" is not automatically safe. A monitor that writes a signal after reading a **merged** entity, or
an ingest path that reads a **soft-deleted** signal, launders a retired row into client-facing output one
hop downstream. Triage priority is therefore NOT alphabetical — it is:
1. **Reads on a write path** (monitor-*, ingest-*, enrich-*, process-*) that read one of these tables and
   then WRITE a signal/incident/entity/report → HIGH priority; these can re-surface a retired row.
2. **Reads feeding an artifact that leaves the building** (any generator not already swept) → HIGH.
3. **Operator-only diagnostic surfaces** (MonitoringDiagnostics, LearningDashboard, AutonomousSystemStatus,
   etc.) → LOW; mark exempt with the operator-surface reason.
4. **Pure internal bookkeeping** (telemetry, health, calibration) → LOW; mark exempt.

## Definition of done
- All 445 reads carry either a named helper or an explicit `@soft-delete-exempt` marker.
- The gate is then promoted to **blocking on OTHER reads too** (drop the client-facing-only carve-out in
  `check-soft-delete-filters.mjs`) so the whole surface is enforced, not just the client-facing slice.
- The `system-watchdog` `softDeleteLeak` runtime probe (WO-LEAK-SWEEP) stays as the behavioral backstop.

## Non-goals
- Not a rewrite; most of the 445 will be one-line marker additions.
- Do not widen the helpers' behavior; do not touch the client-facing enforcement (already blocking).
