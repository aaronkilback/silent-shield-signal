-- Fortress Confidence Layer Migration
-- QA test results table, bug_reports column additions, cron schedules

create table if not exists qa_test_results (
  id uuid primary key default gen_random_uuid(),
  test_suite text not null,
  test_name text not null,
  passed boolean not null,
  expected_outcome text,
  actual_outcome text,
  error_message text,
  response_time_ms integer,
  is_known_broken boolean default false,
  known_broken_reason text,
  severity text default 'medium',
  tested_at timestamptz default now()
);

create index if not exists qa_test_results_tested_at_idx on qa_test_results(tested_at desc);
create index if not exists qa_test_results_passed_idx on qa_test_results(passed, tested_at desc);

alter table bug_reports
  add column if not exists status text default 'open',
  add column if not exists ai_category text,
  add column if not exists ai_diagnosis text,
  add column if not exists ai_severity text,
  add column if not exists affects_client_facing boolean default false,
  add column if not exists watchdog_note text,
  add column if not exists triaged_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_notes text;

-- Cron: QA agent every 6 hours
select cron.schedule(
  'fortress-qa-6h',
  '0 */6 * * *',
  $$ select net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-qa-agent',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true), 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  ) $$
);

-- Cron: Chaos monkey weekly on Sundays at 3am UTC
select cron.schedule(
  'fortress-chaos-weekly',
  '0 3 * * 0',
  $$ select net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-chaos-monkey',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true), 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  ) $$
);
