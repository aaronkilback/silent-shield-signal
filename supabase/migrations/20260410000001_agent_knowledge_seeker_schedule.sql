-- =============================================================================
-- Schedule agent-knowledge-seeker daily at 04:00 UTC
-- Date: 2026-04-10
--
-- The function was built for scheduled use (cron_heartbeat job name hardcoded
-- as 'agent-knowledge-seeker-4am') but never had a cron entry created.
--
-- Behaviour per run:
--   - Picks the 5 least-recently-updated active agents (natural rotation)
--   - Runs 8 knowledge angles per agent via Perplexity sonar-pro
--   - Monitors 4 practitioner sources for recent content
--   - Skips agents already hunted within 6 days (dedup guard)
--   - With 47 agents at 5/day, full rotation completes every ~10 days
-- =============================================================================

SELECT cron.schedule(
  'fortress-agent-knowledge-seeker-4am',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-knowledge-seeker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
