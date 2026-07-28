-- INC-RLS-EXPOSURE-2026-07-28: RLS policies for the frontend-read tables that
-- could not be blind-enabled (operator ruling). Applied prod + staging via
-- apply_migration; this file is the repo record. `if exists` + `drop policy if
-- exists` make it re-runnable and env-safe (academy schema differs slightly
-- between prod/staging; staging-only academy_courses handled in a staging-direct
-- migration).

-- Benchmark: operator-only read (Constellation viz runs in the operator session).
alter table if exists public.benchmark_results enable row level security;
drop policy if exists benchmark_results_operator_read on public.benchmark_results;
create policy benchmark_results_operator_read on public.benchmark_results
  for select to authenticated using (public.is_super_admin(auth.uid()));

alter table if exists public.benchmark_runs enable row level security;
drop policy if exists benchmark_runs_operator_read on public.benchmark_runs;
create policy benchmark_runs_operator_read on public.benchmark_runs
  for select to authenticated using (public.is_super_admin(auth.uid()));

alter table if exists public.benchmark_examples enable row level security;
drop policy if exists benchmark_examples_operator_read on public.benchmark_examples;
create policy benchmark_examples_operator_read on public.benchmark_examples
  for select to authenticated using (public.is_super_admin(auth.uid()));

-- Academy shared curriculum: authenticated read.
alter table if exists public.academy_scenarios enable row level security;
drop policy if exists academy_scenarios_auth_read on public.academy_scenarios;
create policy academy_scenarios_auth_read on public.academy_scenarios
  for select to authenticated using (true);

-- Academy per-user tables: owner-scoped (learner_profiles carries PII).
alter table if exists public.academy_judgment_progress enable row level security;
drop policy if exists academy_judgment_progress_own on public.academy_judgment_progress;
create policy academy_judgment_progress_own on public.academy_judgment_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table if exists public.academy_learner_profiles enable row level security;
drop policy if exists academy_learner_profiles_own on public.academy_learner_profiles;
create policy academy_learner_profiles_own on public.academy_learner_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table if exists public.academy_responses enable row level security;
drop policy if exists academy_responses_own on public.academy_responses;
create policy academy_responses_own on public.academy_responses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
