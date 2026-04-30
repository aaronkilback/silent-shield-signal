-- Reconcile drift between migration manifest and live pg_cron, surfaced by
-- validate-cron-alignment.mjs Check 5 on 2026-04-30. Three items:
--
--   (1) sync-buzzsprout-daily — scheduled live in pg_cron but no migration ever
--       declared it. Add it here so the manifest matches reality. Schedule
--       matches what is already loaded ("0 7 * * *" — daily at 7am UTC).
--
--   (2) social-monitor-30min — declared in early migration
--       20251002035019 but never made it into pg_cron (migration not applied
--       in prod, or unscheduled out-of-band). The successor monitor
--       monitor-social-unified handles this surface area now. Unschedule
--       formally so the manifest reflects the intentional removal.
--
--   (3) academy-followup-daily — same shape as (2): declared in
--       20260410000007 but absent from pg_cron. The academy-followup
--       function is still in use but the cron schedule was deprecated.
--       Unschedule formally.
--
-- Each unschedule is wrapped in a guarded SELECT so this migration is
-- idempotent against pg_cron — running it twice or against a database where
-- the job is already absent is a no-op.

-- (1) Add sync-buzzsprout-daily to manifest
SELECT cron.unschedule('sync-buzzsprout-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-buzzsprout-daily');
SELECT cron.schedule(
  'sync-buzzsprout-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/sync-buzzsprout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- (2) Formally remove social-monitor-30min
SELECT cron.unschedule('social-monitor-30min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'social-monitor-30min');

-- (3) Formally remove academy-followup-daily
SELECT cron.unschedule('academy-followup-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'academy-followup-daily');
