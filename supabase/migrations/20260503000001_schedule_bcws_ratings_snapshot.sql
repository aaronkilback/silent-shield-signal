-- Daily snapshot of the BCWS official fire danger rating per station.
-- Required so that wildfire_station_ratings accumulates one row per
-- station per day, which is the only way Petronas's '# Days at Current
-- Rating' column can be honest. Without this cron, the count is capped
-- at the number of times the wildfire daily report was manually
-- generated (3 in 21 days as of 2026-05-03).
--
-- Schedule: 13:05 UTC = 06:05 MT, ahead of the 07:00 MT daily briefing.
-- Off the :00 minute so it doesn't pile onto the existing :00 herd.

SELECT cron.schedule(
  'snapshot-bcws-ratings-daily',
  '5 13 * * *',
  $$
    SELECT net.http_post(
      url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/snapshot-bcws-ratings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Register in cron_job_registry so the watchdog tracks heartbeats.
INSERT INTO public.cron_job_registry (
  job_name, expected_interval_minutes, description, is_critical
) VALUES (
  'snapshot-bcws-ratings-daily',
  1440, -- once per day
  'Daily snapshot of BCWS official danger rating per Petronas AWS station. Drives the days_at_current_rating column in wildfire_station_ratings.',
  true  -- critical: without this, days-at-rating column degrades over time
) ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;
