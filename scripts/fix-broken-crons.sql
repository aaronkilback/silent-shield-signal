-- Fix the 10 broken pg_cron jobs that have been failing 100% due to missing GUCs/vault entries.
--
-- Root cause: cron commands referenced `current_setting('app.supabase_url')`,
-- `current_setting('app.service_role_key')`, or vault entries that don't exist
-- (uppercase SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). All return NULL/error
-- before net.http_post is invoked.
--
-- Fix: rewrite each cron command to use vault.decrypted_secrets with names that
-- already exist (`SUPABASE_URL` was added 2026-04-29 via Management API; lowercase
-- `service_role_key` already existed).
--
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/kpuqukppbmwebiptqmog/sql/new
--
-- Verification after running:
-- SELECT j.jobname, count(*) FILTER (WHERE jrd.status='succeeded') AS ok,
--        count(*) FILTER (WHERE jrd.status='failed') AS fail,
--        max(jrd.start_time) AS last_run
-- FROM cron.job_run_details jrd JOIN cron.job j ON j.jobid = jrd.jobid
-- WHERE j.jobname IN (
--   'monitor-naad-alerts-15min','monitor-csis-6h','monitor-pastebin-6h',
--   'monitor-darkweb-6h','monitor-github-6h','monitor-court-registry-4h',
--   'monitor-wildfires','agent-self-learning-proactive-8h',
--   'proactive-intelligence-push-15min','monitor-social-unified'
-- ) AND jrd.start_time >= now() - interval '30 minutes'
-- GROUP BY j.jobname ORDER BY j.jobname;
--
-- Should show ok > 0 and fail = 0 within 30 minutes.

-- ─── monitor-naad-alerts-15min (every 15 min) ────────────────────────────────
SELECT cron.unschedule('monitor-naad-alerts-15min');
SELECT cron.schedule(
  'monitor-naad-alerts-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-naad-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-csis-6h (every 6h on the hour) ──────────────────────────────────
SELECT cron.unschedule('monitor-csis-6h');
SELECT cron.schedule(
  'monitor-csis-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-csis',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-pastebin-6h (every 6h at :30) ───────────────────────────────────
SELECT cron.unschedule('monitor-pastebin-6h');
SELECT cron.schedule(
  'monitor-pastebin-6h',
  '30 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-pastebin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-darkweb-6h (every 6h at :15) ────────────────────────────────────
SELECT cron.unschedule('monitor-darkweb-6h');
SELECT cron.schedule(
  'monitor-darkweb-6h',
  '15 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-darkweb',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-github-6h (every 6h at :45) ─────────────────────────────────────
SELECT cron.unschedule('monitor-github-6h');
SELECT cron.schedule(
  'monitor-github-6h',
  '45 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-github',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-court-registry-4h (every 4h on the hour) ────────────────────────
SELECT cron.unschedule('monitor-court-registry-4h');
SELECT cron.schedule(
  'monitor-court-registry-4h',
  '0 */4 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-court-registry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-wildfires (every 15 min) ────────────────────────────────────────
SELECT cron.unschedule('monitor-wildfires');
SELECT cron.schedule(
  'monitor-wildfires',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-wildfires',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── agent-self-learning-proactive-8h (every 8h on the hour) ─────────────────
SELECT cron.unschedule('agent-self-learning-proactive-8h');
SELECT cron.schedule(
  'agent-self-learning-proactive-8h',
  '0 */8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/agent-self-learning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"mode":"proactive","max_queries":5}'::jsonb
  )
  $cron$
);

-- ─── proactive-intelligence-push-15min (every 15 min) ────────────────────────
SELECT cron.unschedule('proactive-intelligence-push-15min');
SELECT cron.schedule(
  'proactive-intelligence-push-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/proactive-intelligence-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── monitor-social-unified (every 30 min) ───────────────────────────────────
SELECT cron.unschedule('monitor-social-unified');
SELECT cron.schedule(
  'monitor-social-unified',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/monitor-social-unified',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ─── Drop the temporary wrapper helper if it exists ──────────────────────────
DROP FUNCTION IF EXISTS public.fix_one_cron(text, text, text);
