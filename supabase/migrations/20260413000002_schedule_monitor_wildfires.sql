-- Schedule monitor-wildfires every 15 minutes.
-- Matches the job_name written to cron_heartbeat inside the function.
-- Sources: NASA FIRMS VIIRS_SNPP_NRT satellite thermal anomaly detection.
-- Enriched with BC Wildfire Service weather stations, fuel type, topography,
-- and industrial flaring classification at known oil/gas facilities.

SELECT cron.schedule(
  'monitor-wildfires',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-wildfires',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'monitor-wildfires',
  15,
  'NASA FIRMS VIIRS wildfire detection for Petronas Canada operational zones (Peace/Montney, Skeena/Kitimat, Southern BC, Calgary). Enriched with BC Wildfire Service weather station context, FBP fuel type, SRTM topography, and industrial flaring discrimination at known gas plants and facilities.',
  true
)
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_minutes = EXCLUDED.expected_interval_minutes,
      description = EXCLUDED.description,
      is_critical = EXCLUDED.is_critical;
