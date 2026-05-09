-- Schedule detect-signal-sequences every 30 minutes.
-- Auth: vault-resolved service_role_key (sb_secret_* post May 9 rotation).

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid FROM cron.job WHERE jobname = 'detect-signal-sequences-30min';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'detect-signal-sequences-30min',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/detect-signal-sequences',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
