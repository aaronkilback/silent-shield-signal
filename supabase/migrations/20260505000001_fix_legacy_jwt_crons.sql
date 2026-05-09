-- Fix legacy-JWT cron jobs — May 5 2026.
--
-- Three pg_cron jobs hardcoded the old service-role JWT directly into
-- their http_post commands. After Supabase rotated its auth layer to
-- require a `sub` claim, the old JWT started returning
--   {"error":"invalid claim: missing sub claim"}  with HTTP 401
-- and the functions stopped firing. The other ~60 crons were fine
-- because they use the vault-lookup pattern, which always pulls the
-- current key:
--   'Authorization', 'Bearer ' || (SELECT decrypted_secret
--                                  FROM vault.decrypted_secrets
--                                  WHERE name = 'service_role_key')
--
-- This migration unschedules each broken job and reschedules it with
-- the vault pattern. Same name, same schedule, same target function —
-- just current auth.
--
-- Affected jobs:
--   • monitor-news-google-hourly         '0 * * * *'   (1h)
--   • monitor-community-outreach-hourly  '30 * * * *'  (1h, offset)
--   • auto-summarize-incidents-nightly   '30 3 * * *'  (daily)
--
-- The community-outreach job's "0 signals across 24 runs" watchdog
-- finding was a downstream symptom of this auth failure — once the
-- function actually receives invocations it should produce signals
-- normally again.

DO $$
BEGIN
  PERFORM cron.unschedule('monitor-news-google-hourly');
  PERFORM cron.unschedule('monitor-community-outreach-hourly');
  PERFORM cron.unschedule('auto-summarize-incidents-nightly');
EXCEPTION WHEN OTHERS THEN
  -- If any of these were already unscheduled, continue. The
  -- subsequent cron.schedule calls below recreate them cleanly.
  RAISE NOTICE 'Some unschedule calls noop''d (likely already absent): %', SQLERRM;
END $$;

SELECT cron.schedule(
  'monitor-news-google-hourly',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-news-google',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'monitor-community-outreach-hourly',
  '30 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-community-outreach',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'auto-summarize-incidents-nightly',
  '30 3 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-summarize-incident',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
