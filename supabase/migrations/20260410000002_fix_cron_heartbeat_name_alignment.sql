-- =============================================================================
-- Fix cron_job_registry names to match what functions actually write to cron_heartbeat
-- Date: 2026-04-10
--
-- Root cause: Functions were written with simple job names hardcoded in their
-- cron_heartbeat upserts. Migrations added later used different naming conventions
-- (e.g., adding frequency suffixes like "-every-15min" or "-nightly"). The watchdog
-- queries cron_heartbeat by the registry name — if they don't match, the watchdog
-- always reports the job as stale, even when it's running fine.
--
-- Approach: Update cron_job_registry to use the names that functions actually write.
-- The pg_cron job name doesn't need to match — it's internal to pg_cron.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AGENT-KNOWLEDGE-SEEKER: fix duplicate + name mismatch
--    - Two cron jobs exist: 'agent-knowledge-seeker-nightly' (Mar 23) and
--      'fortress-agent-knowledge-seeker-4am' (Apr 10) — both at 0 4 * * *
--    - Function writes heartbeat as 'agent-knowledge-seeker-4am'
--    - Fix: drop both duplicates, create one with correct name, update registry
-- -----------------------------------------------------------------------------

SELECT cron.unschedule('agent-knowledge-seeker-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-knowledge-seeker-nightly');

SELECT cron.unschedule('fortress-agent-knowledge-seeker-4am')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fortress-agent-knowledge-seeker-4am');

SELECT cron.schedule(
  'agent-knowledge-seeker-4am',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-knowledge-seeker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"max_agents": 5}'::jsonb
  )
  $$
);

-- Update registry: remove old misnamed entry, insert correct one
DELETE FROM public.cron_job_registry WHERE job_name = 'agent-knowledge-seeker-nightly';

-- Insert in case it didn't exist
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('agent-knowledge-seeker-4am', 1440, 'Nightly agent knowledge hunt — 5 agents/run, 8 angles, Perplexity sonar-pro, 6-day dedup guard', false)
ON CONFLICT (job_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. MONITOR-THREAT-INTEL: function writes 'monitor-threat-intel'
--    Registry has 'monitor-threat-intel-every-15min' (if registered at all)
-- -----------------------------------------------------------------------------

DELETE FROM public.cron_job_registry WHERE job_name = 'monitor-threat-intel-every-15min';

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('monitor-threat-intel', 15, 'Monitors threat intelligence feeds every 15 minutes', true)
ON CONFLICT (job_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. THREAD-WEAVER: function writes 'thread-weaver-2am'
--    Registry has 'thread-weaver-nightly'
-- -----------------------------------------------------------------------------

DELETE FROM public.cron_job_registry WHERE job_name = 'thread-weaver-nightly';

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('thread-weaver-2am', 1440, 'Nightly thread weaving — correlates signals into emerging narrative threads', false)
ON CONFLICT (job_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. SELF-IMPROVEMENT-ORCHESTRATOR: function writes 'self-improvement-nightly'
--    Registry has 'self-improvement-orchestrator-nightly'
-- -----------------------------------------------------------------------------

DELETE FROM public.cron_job_registry WHERE job_name = 'self-improvement-orchestrator-nightly';

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('self-improvement-nightly', 1440, 'Nightly AI self-improvement cycle — calibration, prompt updates, learning triggers', false)
ON CONFLICT (job_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. MONITOR-SOCIAL-UNIFIED: function writes 'monitor-social-unified'
--    Registry has 'social-monitor-unified-30min' (word order reversed + suffix)
--    Note: 'monitor-social-unified' may already exist correctly — just clean up alias
-- -----------------------------------------------------------------------------

DELETE FROM public.cron_job_registry WHERE job_name = 'social-monitor-unified-30min';

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('monitor-social-unified', 30, 'Monitors unified social media feeds every 30 minutes', false)
ON CONFLICT (job_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. MONITOR-RSS-SOURCES: function writes 'monitor-rss-sources'
--    Registry likely has 'monitor-rss-every-15min'
-- -----------------------------------------------------------------------------

DELETE FROM public.cron_job_registry WHERE job_name = 'monitor-rss-every-15min';

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('monitor-rss-sources', 15, 'Monitors RSS sources every 15 minutes', false)
ON CONFLICT (job_name) DO NOTHING;
