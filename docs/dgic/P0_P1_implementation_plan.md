# DGIC P0 + P1 — Implementation Plan (staging-first, gated)

**Status:** PLAN for review. **No apply. No deploy.** Each step ends at a STOP-for-review gate.
**Design baseline:** v0.2 drafts in this folder (locked decisions: PUBLICATION_TS_ABSENT = doctrine for publisher-class; skip_relevance_gate w/o linkage = sub_grade).
**Envs:** staging `lkvyrvuakzguszbpwnfz` first; prod `kpuqukppbmwebiptqmog` later (separate gated step, out of scope here).
**Doctrine alignment:** P1 is audit-only → matches the "audit-before-blocking" rule (ship audit-only, promote to enforcing only after findings are triaged).

---

## Step 0 — Canonical-controller static audit (READ-ONLY, prerequisite)

The bypass canary is only meaningful if `ingest-signal` is genuinely the sole writer of operator-visible `signals`. Before anything:

- Static grep across `supabase/functions/`: any `.from('signals').insert|upsert` OR raw `INSERT INTO ... signals` **outside** `ingest-signal/index.ts`.
- Any direct writer found = a pre-existing bypass defect → must be routed through `ingest-signal` (or explicitly `// @qa-allow:` annotated) **before** P1, else the canary will false-alarm or miss real bypasses.
- Deliverable: a short list (expected: empty or a known exception). **Gate:** clean list before Step 2.

---

## Artifacts to produce (promote v0.2 drafts → real files)

| Artifact | From draft | Notes |
|---|---|---|
| `supabase/migrations/<ts>_dgic_p0_signals_columns.sql` | `P0_a` | **Columns only** (6 ADD COLUMN, metadata-only). **No indexes** (txn forbids CONCURRENTLY). |
| Index step (NOT a migration) | `P0_a` index block | 4× `CREATE INDEX CONCURRENTLY` run individually via `execute_sql` (non-txn). |
| `supabase/migrations/<ts>_dgic_p0_config_sink_views.sql` | `P0_b` | `dgic_config`, `dgic_evaluations`, 6 views, RLS+grants. Txn-safe. |
| Config seed | `P0_b` | `contract_version=v0.2, skew_tolerance_hours=26, stale_horizon_days=90, monitor_band=0.45`. **`go_live_ts` set later, at evaluator deploy.** |
| `supabase/functions/_shared/dgic.ts` | `evaluateDGIC.draft.ts` | Pure evaluator + config types. |
| `ingest-signal/index.ts` integration | caller wrapper | Cached config load; evaluate→stamp before insert; latency→telemetry; awaited `audit_error` sink write; **no `quality_status` change.** |

---

## Step 1 — P0 schema to STAGING (gated)

1. `apply_migration` (staging): `_dgic_p0_signals_columns` (columns). Metadata-only → instant, no rewrite.
2. `execute_sql` (staging), one per statement: the 4 `CREATE INDEX CONCURRENTLY`. (Cannot run inside `apply_migration`'s txn.)
3. `apply_migration` (staging): `_dgic_p0_config_sink_views` (config, sink, views, RLS, grants).
4. `execute_sql` (staging): seed `dgic_config` (everything **except** `go_live_ts`).

**Exit criteria (report, then STOP):**
- All 6 columns present on `signals`; all 4 indexes valid; all 6 views queryable (return zeros/empties).
- RLS/grants: `anon` + `authenticated` **denied** on `dgic_config`, `dgic_evaluations`, and every `dgic_*` view (impersonation probe). `service_role` reads OK.
- **Inertness proof:** insert a throwaway staging signal the normal way → confirm existing pipeline behavior unchanged (row created, `dgic_*` still NULL because the evaluator isn't wired yet). Clean it up.
- No new entries in `dgic_bypass_canary` semantics yet (`go_live_ts` unset → canary matches nothing — fail-safe confirmed).

---

## Step 2 — P1 evaluator to STAGING (audit-only, gated)

1. Add `_shared/dgic.ts` (v0.2 evaluator).
2. Wire `ingest-signal`:
   - **Config loader:** module-level cache of `dgic_config` with a short TTL (e.g., 5 min) → one read per warm worker, **not per signal**.
   - **Evaluate before the `signals` insert;** stamp `signalPatch` columns + merge `rawJsonPatch` into `raw_json`; on evaluator throw → `dgic_status='audit_error'` + awaited `dgic_evaluations` exception row.
   - **Latency:** record `dgic_evaluator_compute_ms` + `dgic_total_overhead_ms` into a terminal `recordTelemetry` (`function_telemetry`, `function_name='ingest-signal'`, `context.stage='dgic_audit'`). *(Measurement-phase write; verify whether ingest-signal already has a terminal telemetry row to augment instead — fold in if so. Sampleable to 1-in-N after the first calibration window.)*
   - **No `quality_status` change. No fail-closed. No relevance floor.** (Audit-only, decision #4.)
3. Deploy `ingest-signal` to **staging only** (`deploy-functions-staging.yml` `workflow_dispatch target=ingest-signal`, or MCP `deploy_edge_function` to staging ref).
4. `execute_sql` (staging): set `dgic_config.go_live_ts = now()` — *the moment stamping begins* (canary baseline).

**Exit criteria (report, then STOP) — staging, realistic load:**
1. `check-staging-load-fixture.mjs` green (Petronas ≥30 kw + canary fixture present).
2. Invoke `monitor-news-google` (and/or a direct `ingest-signal` test set) on staging → new signals carry `dgic_status` + `dgic.findings`.
3. **Bypass canary GREEN:** `select count(*) from dgic_bypass_canary` = 0 (every post-go-live active signal stamped).
4. **Inertness (the critical proof):** a monitor run's admitted-signal count, `quality_status` distribution, dedup/relevance behavior are **identical** to a pre-P1 run. DGIC changed nothing about admission.
5. **Baseline populated:** `dgic_baseline_24h` (DGR, crit/high reasoning %), `dgic_violation_histogram_24h`, `dgic_chronology_calibration_7d` return real numbers. (Expect ugly DGR + low crit/high coverage — that's the truth we're after.)
6. **audit_error rate** (`dgic_audit_error_rate_24h`) ≈ 0; any audit_error has a detail row in `dgic_evaluations`.
7. **LATENCY GATE (see below) passes.**

---

## The Latency Gate (P1's hard pass/fail — protects monitor budgets)

DGIC overhead is per-signal; a high-volume monitor multiplies it. From `dgic_latency_24h`:
- `avg_compute_ms` and `max_compute_ms` (pure sync) — **expected sub-millisecond to low single digits** (no I/O). If `max_compute_ms` is large, the evaluator has a hot path to fix.
- `avg/max_overhead_ms` (incl. stamp-merge + any awaited audit_error write).
- **Budget check:** confirm `monitor-news-google` heartbeat `duration_ms` stays **< 135_000** and `result_summary.elapsed_ms ≤ budget_ms + 30_000` *with DGIC live* (the 105s budget is already tight). Cross-check over ≥2 consecutive cursor-resume runs.
- **PASS** = compute negligible **and** no monitor breaches its budget criteria. **FAIL** = surface as a defect; do not proceed to prod (consider sampling the latency write, or optimizing the evaluator).

---

## Step 3 — PROD rollout (LATER, separate gated step — summary only, not for now)
Same sequence on prod after staging burns in clean: columns migration → CONCURRENTLY indexes → config/sink/views migration → seed (no go_live_ts) → deploy `ingest-signal` prod → set `go_live_ts`. Validate canary/inertness/latency/baseline on prod. Each sub-step gated.

---

## Risks & rollback
- **Latency multiplied by volume** → the Latency Gate is the explicit guard; pure-sync design keeps it small; rollback = redeploy `ingest-signal` without the DGIC stage (columns stay, harmlessly NULL).
- **Index build on large `signals`** → CONCURRENTLY (non-blocking); GIN build may take time but doesn't lock writes.
- **Config cache staleness** → short TTL; config rarely changes; acceptable in audit phase.
- **raw_json key collision** → `dgic_*`-prefixed keys avoid clashing with existing keys (verify in Step 2).
- **Schema rollback** → drop the 6 columns + indexes + dgic tables/views (clean; no live pipeline dependency since admission ignores them in P1).
- **Doctrine note:** P1 makes DGR look bad (PUBLICATION_TS_ABSENT + skip-gate→sub_grade by approved design). This is intended truth, not a regression — no operator visibility changes in P1.

---

## Validation query appendix (staging; read-only)
```sql
-- canary (must be 0)
select count(*) from dgic_bypass_canary;
-- baseline truth
select * from dgic_baseline_24h;
select * from dgic_violation_histogram_24h;
select * from dgic_chronology_calibration_7d;     -- calibrate the 26h skew empirically
select * from dgic_latency_24h;                   -- latency gate
-- inertness: compare admitted counts/quality_status pre vs post P1 deploy over equal windows
select quality_status, count(*) from signals where created_at > now()-interval '1 hour' group by 1;
-- grants: each must ERROR for anon/authenticated
-- begin; set local role authenticated; select 1 from dgic_evaluations; rollback;
```
