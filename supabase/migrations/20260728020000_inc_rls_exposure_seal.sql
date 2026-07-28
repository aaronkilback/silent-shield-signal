-- INC-RLS-EXPOSURE-2026-07-28: enable RLS (deny-by-default) on public tables that
-- were RLS-disabled and anon-readable (Supabase advisory rls_disabled_in_public).
-- Writers are service-role (bypass RLS) per the WO-DATA-INTEGRITY audit, so
-- deny-by-default is correct and non-breaking for these tables. `IF EXISTS`
-- guards make this safe across prod + staging (some tables are env-specific).
--
-- NOT included here (HELD — frontend reads them with anon/user JWTs; enabling RLS
-- without a policy would break the app): benchmark_results, benchmark_runs,
-- benchmark_examples (constellation viz), academy_scenarios,
-- academy_judgment_progress/academy_progress, academy_learner_profiles,
-- academy_courses, cron_heartbeat, cron_job_registry (staging). See the incident
-- record for the ruling.
alter table if exists public.entity_suggestions_null_tenant_backfill_snapshot_20260522 enable row level security;
alter table if exists public._repair_tenant_backfill_20260602 enable row level security;
alter table if exists public.ops_backfill_2026_05_19_tenant_id enable row level security;
alter table if exists public.llm_daily_cost enable row level security;
alter table if exists public.llm_model_pricing enable row level security;
alter table if exists public.llm_budget_caps enable row level security;
alter table if exists public.wave1_prod_audit_runs enable row level security;
alter table if exists public.wave1_smoke_runs enable row level security;
alter table if exists public.academy_responses enable row level security;
alter table if exists public.academy_agent_scores enable row level security;
alter table if exists public.academy_progress enable row level security;
alter table if exists public.app_feature_flags enable row level security;
alter table if exists public.entity_governance_writer_policy enable row level security;
alter table if exists public.entity_governance_verdict_policy enable row level security;
alter table if exists public.environment_marker enable row level security;
alter table if exists public.schema_fingerprint enable row level security;
