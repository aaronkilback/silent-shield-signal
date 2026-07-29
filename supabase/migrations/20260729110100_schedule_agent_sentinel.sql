-- WO-SENTINEL-1: schedule the daily security posture probe (08:00 UTC).
-- Heartbeat job_name must match the cron jobname: 'agent-sentinel-daily'.
SELECT cron.unschedule('agent-sentinel-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'agent-sentinel-daily'
);
SELECT cron.schedule(
  'agent-sentinel-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-sentinel',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  )
  $$
);
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('agent-sentinel-daily', 1440,
  'WO-SENTINEL-1: daily defensive security posture probe — RLS-disabled/anon-readable check + empirical anon-key exposure test on sensitive tables. Writes findings via record_platform_finding. No pentesting.',
  true)
ON CONFLICT (job_name) DO UPDATE SET expected_interval_minutes = 1440, description = EXCLUDED.description;
