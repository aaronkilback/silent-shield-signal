-- Schedule monitor-twitter to run every 30 minutes.
--
-- Uses Twitter API v2 recent search (Bearer Token).
-- Free tier limit: 1 req / 15 min per app.
-- The function makes 2 API calls per run (person-threat + campaign),
-- so 30-minute interval keeps well within that limit.

SELECT cron.unschedule('monitor-twitter-30min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'monitor-twitter-30min'
);

SELECT cron.schedule(
  'monitor-twitter-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-twitter',
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
  ('monitor-twitter-30min', 30, 'Twitter/X API v2 threat and campaign monitoring for all clients and person entities', false)
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_minutes = 30,
      description = EXCLUDED.description;
