-- Ground-travel journey management: scan for overdue check-ins every 5 minutes
-- and raise escalation alerts. Pairs with the on-load invoke from /travel.

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('monitor-journey-checkins-5min');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unschedule noop (likely first run): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'monitor-journey-checkins-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-journey-checkins',
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
  'monitor-journey-checkins-5min',
  5,
  'Ground-travel journey management: flags active ground journeys whose scheduled check-in has lapsed (journey_overdue=true) and raises a high-severity travel_alert per overdue event. A driver/operator check-in resets the flag. Alerts are client-scoped via the journey lead traveler.',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

COMMIT;
