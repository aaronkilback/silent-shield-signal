-- =============================================================================
-- FORTRESS PHASE 4C: CROSS-SIGNAL PATTERN DETECTION — SCHEDULE + ENTITY UPGRADE
-- Date: 2026-04-07
-- Schedules detect-threat-patterns to run every 6 hours (aligned with QA suite).
-- =============================================================================

-- Schedule detect-threat-patterns every 6 hours
-- Runs at :15 past each 6h mark to avoid collision with other crons
SELECT cron.schedule(
  'fortress-detect-patterns-6h',
  '15 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/detect-threat-patterns',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
