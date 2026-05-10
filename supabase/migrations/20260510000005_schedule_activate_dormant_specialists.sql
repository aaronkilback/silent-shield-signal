-- Schedule activate-dormant-specialists daily at 06:00 UTC.
--
-- Forces breadth in specialist activity by giving every active agent
-- at least one in-lane signal per week. Without this, the bottom
-- quartile of the fleet writes zero analyses, which means:
--   • the calibration loop has no data on those agents → they never
--     get a Brier score → confidence-attenuation never bites them
--   • the persona audit shows them dormant indefinitely
--   • their specialty embedding stays untested against real signals
--
-- Schedule: daily at 06:00 UTC (offset from the 04:00 calibration job
-- so the post-activation rows have time to land before the next
-- calibration grading run, but inside the same day).

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('activate-dormant-specialists-daily');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unschedule noop (likely first run): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'activate-dormant-specialists-daily',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/activate-dormant-specialists',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'activate-dormant-specialists-daily',
  1440,
  'Picks the bottom-quartile of active specialists by 7-day analysis volume and assigns each one a recent in-lane admitted signal. Caps at 8 dispatches per run. Closes the breadth gap so calibration accumulates evidence across the whole fleet.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

COMMIT;
