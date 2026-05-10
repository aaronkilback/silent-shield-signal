-- Schedule score-agent-calibration daily at 04:00 UTC — May 10 2026.
--
-- Closes the agent learning loop: walks the prior week's resolved /
-- false_positive signals, grades each agent's confidence_score against
-- the actual outcome, and rolls Brier + calibration into
-- agent_calibration_scores. Was uninstrumented (the table existed with
-- 0 rows for ~6 weeks), which meant chronically over-confident agents
-- looked identical to well-calibrated ones in the rest of the system.
--
-- Schedule: daily at 04:00 UTC. Off-hours so it doesn't collide with
-- the every-15-min monitors. 04:00 sits well after the nightly
-- agent-self-learning-proactive run.
-- Heartbeat job_name: score-agent-calibration-daily (must match the
-- startHeartbeat call inside the function).

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('score-agent-calibration-daily');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unschedule noop (likely first run): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'score-agent-calibration-daily',
  '0 4 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/score-agent-calibration',
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
  'score-agent-calibration-daily',
  1440,
  'Walks last-7d resolved/false_positive signals, computes Brier + calibration per (call_sign, domain), upserts running totals into agent_calibration_scores. Closes the prediction → outcome → calibration loop.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

COMMIT;
