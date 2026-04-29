-- Fix the 2 broken pg_cron jobs in the agent learning pipeline.
--
-- Root cause: the cron commands have literal newlines + indent whitespace
-- embedded inside the URL strings. When PostgreSQL builds the URL it
-- contains those newlines, and net.http_post rejects with
--   ERROR: URL using bad/illegal format or missing URL
--
-- Examples of the broken strings:
--   'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-knowle\n  dge-seeker'
--   'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/self-improve\n  ment-orchestrator'
--
-- Effect: 7 of 7 daily runs failed for each. Watchdog flags this as
-- "Agent learning pipeline has stalled" and recurring QA test
-- agent_learning_active fails because beliefs aren't updating.
--
-- Fix: rewrite each command with a clean URL and use vault.decrypted_secrets
-- for auth (same pattern as fix-broken-crons.sql).
--
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/kpuqukppbmwebiptqmog/sql/new
--
-- Verification 24h after running: both jobs should have ok > 0 and fail = 0
-- in cron.job_run_details, and the agent_learning_active QA test should pass.

-- ─── agent-knowledge-seeker-4am (daily at 4:00 UTC) ──────────────────────────
SELECT cron.unschedule('agent-knowledge-seeker-4am');
SELECT cron.schedule(
  'agent-knowledge-seeker-4am',
  '0 4 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/agent-knowledge-seeker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"max_agents": 5}'::jsonb
  )
  $cron$
);

-- ─── self-improvement-nightly (daily at 3:00 UTC) ────────────────────────────
SELECT cron.unschedule('self-improvement-nightly');
SELECT cron.schedule(
  'self-improvement-nightly',
  '0 3 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/self-improvement-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
