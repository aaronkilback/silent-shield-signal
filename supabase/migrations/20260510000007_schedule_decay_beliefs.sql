-- Schedule decay-beliefs-from-calibration daily at 04:30 UTC,
-- 30 minutes after score-agent-calibration runs at 04:00. The
-- order matters: calibration must rebuild fresh Brier scores
-- before belief decay reads them. This sequencing closes the loop:
--   04:00 — calibration rebuilds (resolved signals → Brier per agent/domain)
--   04:30 — beliefs decay or bump based on the just-rebuilt Brier
--   06:00 — dormant specialists get assigned new in-lane signals
--   ... ingest + analyses through the day ...
--   next day 04:00 — calibration grades the new analyses, loop continues.

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('decay-beliefs-from-calibration-daily');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unschedule noop (likely first run): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'decay-beliefs-from-calibration-daily',
  '30 4 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/decay-beliefs-from-calibration',
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
  'decay-beliefs-from-calibration-daily',
  1440,
  'Reads agent_calibration_scores Brier values and adjusts agent_beliefs.confidence by ±0.05 per run for matching domains. Closes the predict→grade→update loop so beliefs evolve from outcomes, not just from snapshot accumulation.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

COMMIT;
