-- WO-INCIDENT-QA Step 4: schedule the incident-lifecycle-sweep (daily 09:00 UTC).
-- Heartbeat job_name must match the cron jobname exactly: 'incident-lifecycle-sweep-daily'.
SELECT cron.unschedule('incident-lifecycle-sweep-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'incident-lifecycle-sweep-daily'
);

SELECT cron.schedule(
  'incident-lifecycle-sweep-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/incident-lifecycle-sweep',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || get_service_role_key()
    ),
    body    := '{}'::jsonb
  )
  $$
);

INSERT INTO public.cron_job_registry
  (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('incident-lifecycle-sweep-daily', 1440,
   'WO-INCIDENT-QA Step 4: hazard event-ended (CAP expiry / 7d quiet) + stale(14d)->expired(+14d) auto-closure. Soft states only.',
   false)
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_minutes = 1440,
      description = EXCLUDED.description;
