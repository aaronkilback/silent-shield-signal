# INC-RLS-EXPOSURE-2026-07-28

**Status:** Prod sealed for the sensitive/internal set; **frontend-read tables HELD for operator ruling** (enabling RLS without a policy would break the app). Staging safe set sealed. Standing rule + watchdog probe added.

**Severity:** CRITICAL (Supabase advisory `rls_disabled_in_public`, 2026-07-26) — public tables with RLS **disabled** AND anon-readable on BOTH prod (`kpuqukppbmwebiptqmog`) and staging (`lkvyrvuakzguszbpwnfz`).

**Trigger:** Supabase security advisory.

## Exposure — confirmed open (prod)
Unauthenticated **anon key** REST SELECT returned real rows:
- `entity_suggestions_null_tenant_backfill_snapshot_20260522` → real intelligence (`"BC Civil Liberties Association"`, source_id, context, confidence).
- `_repair_tenant_backfill_20260602` → **tenant_id + client_id mappings** (Petronas `0f5c809d…`) + `signal_agent_analyses` row_ids — leaks tenant/client structure + ownership.
- `benchmark_results` → benchmark run rows.

RLS-disabled + `anon` holds SELECT grant = anyone with the public anon key could read. Barn door was open.

## Prod enumeration (public tables, RLS disabled at time of incident)

| Table | Rows | Sensitivity | Frontend-read | Action |
|---|---|---|---|---|
| `entity_suggestions_null_tenant_backfill_snapshot_20260522` | 46 | SENSITIVE (entity/tenant) | no | ✅ RLS enabled |
| `_repair_tenant_backfill_20260602` | 1283 | SENSITIVE (tenant/client map) | no | ✅ RLS enabled |
| `ops_backfill_2026_05_19_tenant_id` | 43 | SENSITIVE (tenant) | no | ✅ RLS enabled |
| `llm_daily_cost` | 2581 | LOW (cost bookkeeping) | no | ✅ RLS enabled |
| `llm_model_pricing` | 5 | LOW (lookup) | no | ✅ RLS enabled |
| `llm_budget_caps` | 1 | LOW (config) | no | ✅ RLS enabled |
| `wave1_prod_audit_runs` | 3 | LOW (audit) | no | ✅ RLS enabled |
| `academy_responses` | 0 | (user data, empty) | no | ✅ RLS enabled |
| `academy_agent_scores` | 0 | LOW (empty) | no | ✅ RLS enabled |
| `app_feature_flags` | 1 | LOW (config) | no | ✅ RLS enabled |
| `benchmark_results` | 3978 | SENSITIVE (benchmark) | **YES** (`useConstellationData.ts`) | ⛔ HELD — policy needed |
| `benchmark_runs` | 102 | SENSITIVE | **YES** | ⛔ HELD — policy needed |
| `benchmark_examples` | 39 | SENSITIVE | **YES** | ⛔ HELD — policy needed |
| `academy_scenarios` | 18 | LOW (curriculum) | **YES** (`Academy.tsx`) | ⛔ HELD — policy needed |
| `academy_judgment_progress` | 0 | (user progress) | **YES** | ⛔ HELD — policy needed |
| `academy_learner_profiles` | 0 | SENSITIVE (PII) | **YES** | ⛔ HELD — policy needed |
| `spatial_ref_sys` | 8500 | LOW (PostGIS system) | n/a | EXCLUDED (extension-owned public reference; known advisory exception) |

**Sealing verified:** post-`ENABLE RLS`, anon SELECT on the sealed tables returns `[]` (deny-by-default; service-role writers bypass RLS, so no writer breakage — consistent with the WO-DATA-INTEGRITY service-role-writer finding).

## HELD FOR RULING — frontend-read tables
These are read by the app directly with anon/user JWTs; enabling RLS with **no policy** returns `[]` and **breaks the feature**:
- **Constellation viz** (`src/hooks/useConstellationData.ts`): `benchmark_results`, `benchmark_runs`, `benchmark_examples` — **SENSITIVE and exposed**. Options: (a) write a read policy (who should see benchmark data? operator-only? authenticated?), (b) move these reads server-side behind an edge function (service-role) + RLS-deny, (c) accept the feature loss and seal. Recommend (b) for the sensitive benchmark data.
- **Academy** (`src/pages/Academy.tsx`): `academy_scenarios`, `academy_judgment_progress`, `academy_learner_profiles` — learner_profiles is PII. Needs per-user RLS policies (owner = `auth.uid()`) before enabling.

## Staging
18 RLS-disabled public tables — **no tenant-data backfill snapshots** (lower severity). Sealed the non-frontend safe set (`academy_progress`, `academy_agent_scores`, `academy_responses`, `entity_governance_writer_policy`, `entity_governance_verdict_policy`, `environment_marker`, `schema_fingerprint`, `wave1_smoke_runs`, `app_feature_flags`, `llm_daily_cost`, `llm_model_pricing`, `llm_budget_caps`). **Config drift found:** `cron_heartbeat` + `cron_job_registry` are RLS-**enabled on prod** (with policies) but RLS-**disabled on staging** — HELD to replicate prod's policies rather than blind-enable (both are frontend-read on staging). Same academy/benchmark holds as prod.

## Access audit (step 5) — honest answer
- Postgres does **not** log individual SELECTs (no pgaudit / `log_statement='all'`), so DB logs cannot attribute historical reads.
- API/Logflare logs capture PostgREST HTTP requests (path/method/status/user-agent) but with **limited retention (~1 day)**. Within the retained window: **only legitimate traffic** — edge functions (`Deno/SupabaseEdgeRuntime`, service-role) + operator browser (user JWT) on normal tables; **zero requests to any exposed table path**.
- **Verdict: no positive evidence of external anon access in the retained window; access prior to it is NOT determinable.** The tables were exposed since creation (weeks–months), far beyond log retention. We cannot prove no access occurred; we have no evidence that it did.

## Standing rule (added)
**Every new table ships with RLS enabled at creation.** Added to `CLAUDE.md`. Enforcement: migration template + a watchdog KB probe (`public` table with `rowsecurity=false` → CRITICAL finding). Backlog spec: `docs/platform-operations/backlog/watchdog-rls-disabled-probe.md`.

## Follow-ups
1. **Ruling on the HELD frontend-read tables** (benchmark ×3, academy ×3) — policy vs server-side move vs seal. Blocking for full closure.
2. Staging `cron_heartbeat`/`cron_job_registry`: replicate prod's RLS policies.
3. Consider **deleting** the one-off backfill-snapshot tables (`_repair_…`, `…_backfill_snapshot_…`, `ops_backfill_…`) — they've served their migration purpose and hold sensitive tenant data. (Not deleted here — standing "nothing deleted" rule; sealed instead. Flag for disposition.)
4. Build the watchdog rls-disabled probe.
