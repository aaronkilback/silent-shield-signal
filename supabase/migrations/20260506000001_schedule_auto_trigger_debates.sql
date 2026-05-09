-- Schedule auto-trigger-debates hourly — May 6 2026.
--
-- Auto-fires command_synthesis debates when incidents accumulate ≥3
-- specialist analyses without a recent debate. Makes multi-agent
-- collaboration the default pattern instead of requiring operator
-- chat initiation. Reports (daily briefing, executive report) now
-- pull from agent_debate_records, so passive auto-firing means reports
-- get substantial multi-agent content even on days when no operator
-- runs the chat workflow.
--
-- Schedule: hourly at :15 (offset from top-of-hour to avoid collision
-- with monitor-* crons that run at :00).
-- Heartbeat job_name: auto-trigger-debates-hourly (matches the
-- function's startHeartbeat call so cron_job_registry alignment
-- check passes).

BEGIN;

-- Drop any earlier schedule if present (rerunnable).
DO $$
BEGIN
  PERFORM cron.unschedule('auto-trigger-debates-hourly');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unschedule noop (likely first run): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'auto-trigger-debates-hourly',
  '15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-trigger-debates',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Register so the watchdog + monitor-health panel know about it.
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'auto-trigger-debates-hourly',
  60,
  'Auto-fires AEGIS-CMD command_synthesis debates when incidents accumulate ≥3 specialist analyses. Compounds specialist work into integrated reasoning trail without requiring operator chat initiation.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

COMMIT;
