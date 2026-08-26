-- Variant A silent-zero probe schedule. Registry name = cron jobname = heartbeat job_name
-- = 'silent-zero-probe-daily'. 05:47 UTC. Audit-only first two scheduled runs (function-enforced).
select cron.schedule(
  'silent-zero-probe-daily',
  '47 5 * * *',
  $$
  select net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/silent-zero-probe',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
select 'silent-zero-probe-daily', 1440,
       'Variant A silent-zero regression probe: one finding per producer that was yielding and went silent; coverage census for all non-healthy states. Audit-only (low severity) for first two scheduled runs, then promotes to high.',
       false
where not exists (select 1 from public.cron_job_registry where job_name='silent-zero-probe-daily');
