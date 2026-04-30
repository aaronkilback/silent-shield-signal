-- Schedule resolve-agent-predictions to close the loop on agent predictions.
--
-- Once daily at 08:00 UTC. Pulls predictions whose expected_by has elapsed,
-- AI-judges them against signals/incidents that materialised since prediction
-- time, updates calibration_scores. Without this resolver,
-- agent_world_predictions stays unused and there is no way to measure whether
-- agents are getting better.

SELECT cron.unschedule('resolve-agent-predictions-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-agent-predictions-daily');
SELECT cron.schedule(
  'resolve-agent-predictions-daily',
  '0 8 * * *',  -- 08:00 UTC daily
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/resolve-agent-predictions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'resolve-agent-predictions-daily',
  1440,
  'Resolves due agent_world_predictions against reality and updates agent_calibration_scores. Closes the agent calibration loop.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;
