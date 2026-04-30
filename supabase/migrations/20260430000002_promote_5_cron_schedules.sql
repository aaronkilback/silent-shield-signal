-- Promote the 5 cron schedules from scripts/fix-broken-crons.sql to a proper migration.
-- These schedules were applied directly via the Supabase SQL Editor on 2026-04-29 to repair
-- a pipeline outage, but the validator at scripts/validate-cron-alignment.mjs cannot see
-- schedules that exist only in pg_cron. Without this migration, those 5 jobs flagged as
-- "writes heartbeat but NO cron schedule found" even though they were running fine.
--
-- The URLs are static so validate-cron-alignment.mjs can parse them. The auth header
-- uses vault.decrypted_secrets (the working pattern as of 2026-04-29 — see
-- scripts/fix-broken-crons.sql for the prior current_setting() pattern that returned
-- NULL).
--
-- Each block is idempotent — unschedule first then schedule.

-- ─── monitor-naad-alerts-15min ────────────────────────────────────────────────
SELECT cron.unschedule('monitor-naad-alerts-15min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-naad-alerts-15min');
SELECT cron.schedule(
  'monitor-naad-alerts-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-naad-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-csis-6h ──────────────────────────────────────────────────────────
SELECT cron.unschedule('monitor-csis-6h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-csis-6h');
SELECT cron.schedule(
  'monitor-csis-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-csis',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-court-registry-4h ────────────────────────────────────────────────
SELECT cron.unschedule('monitor-court-registry-4h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-court-registry-4h');
SELECT cron.schedule(
  'monitor-court-registry-4h',
  '0 */4 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-court-registry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── agent-self-learning-proactive-8h ─────────────────────────────────────────
SELECT cron.unschedule('agent-self-learning-proactive-8h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-self-learning-proactive-8h');
SELECT cron.schedule(
  'agent-self-learning-proactive-8h',
  '0 */8 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-self-learning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"mode":"proactive","max_queries":5}'::jsonb
  )
  $cron$
);

-- ─── proactive-intelligence-push-15min ────────────────────────────────────────
SELECT cron.unschedule('proactive-intelligence-push-15min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proactive-intelligence-push-15min');
SELECT cron.schedule(
  'proactive-intelligence-push-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/proactive-intelligence-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
