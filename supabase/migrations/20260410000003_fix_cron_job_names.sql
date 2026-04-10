-- =============================================================================
-- Fix remaining pg_cron job naming issues
-- Date: 2026-04-10
--
-- Companion to 20260410000002 which fixed cron_job_registry names.
-- This fixes the actual pg_cron job names to match what functions write
-- to cron_heartbeat, cleans up duplicates, and fixes one orphaned job.
--
-- Issues addressed:
--   1. monitor-rss-sources: cron named 'monitor-rss-every-15min'
--   2. monitor-social-unified: cron named 'social-monitor-unified-30min'
--   3. monitor-threat-intel: two cron jobs (hourly + 15min), neither named correctly
--   4. self-improvement-orchestrator: cron named 'self-improvement-orchestrator-nightly'
--   5. thread-weaver: cron named 'thread-weaver-nightly'
--   6. wraith-security-advisor: cron points to non-existent 'wraith-ai-defense' URL
--   7. autonomous-operations-loop: duplicate cron (hourly ooda-loop + 30min)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. monitor-rss-sources
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('monitor-rss-every-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-rss-every-15min');

SELECT cron.schedule(
  'monitor-rss-sources',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-rss-sources',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 2. monitor-social-unified
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('social-monitor-unified-30min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'social-monitor-unified-30min');

SELECT cron.schedule(
  'monitor-social-unified',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-social-unified',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 3. monitor-threat-intel
--    Remove: 'threat-intel-60min' (old hourly, superseded)
--    Remove: 'monitor-threat-intel-every-15min' (misnamed)
--    Add:    'monitor-threat-intel' (matches function heartbeat)
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('threat-intel-60min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'threat-intel-60min');

SELECT cron.unschedule('monitor-threat-intel-every-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-threat-intel-every-15min');

SELECT cron.schedule(
  'monitor-threat-intel',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-threat-intel',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 4. self-improvement-orchestrator
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('self-improvement-orchestrator-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-improvement-orchestrator-nightly');

SELECT cron.schedule(
  'self-improvement-nightly',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/self-improvement-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 5. thread-weaver
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('thread-weaver-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thread-weaver-nightly');

SELECT cron.schedule(
  'thread-weaver-2am',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/thread-weaver',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 6. wraith-security-advisor: fix orphaned cron pointing to non-existent 'wraith-ai-defense'
--    The function was renamed from wraith-ai-defense to wraith-security-advisor.
--    Job keeps the name 'wraith-vuln-scan-nightly' but URL must be updated.
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('wraith-vuln-scan-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wraith-vuln-scan-nightly');

SELECT cron.schedule(
  'wraith-vuln-scan-nightly',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/wraith-security-advisor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"action": "run_vulnerability_scan"}'::jsonb
  )
  $$
);

-- -----------------------------------------------------------------------------
-- 7. autonomous-operations-loop: remove old duplicate hourly job
--    'autonomous-ooda-loop-15min' (hourly, 0 * * * *) was superseded by
--    'autonomous-operations-loop-15min' (every 30min, */30 * * * *)
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('autonomous-ooda-loop-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-ooda-loop-15min');
