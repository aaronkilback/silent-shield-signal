-- Cron schedule alignment repair (2026-05-19).
--
-- After the May 2026 platform stabilization, three pg_cron jobs that
-- had been removed from live (via SQL Editor or admin action) were
-- never reflected in migrations, AND one job that runs in live (the
-- new monitor-instagram-2h cadence) was scheduled directly without a
-- migration. scripts/validate-cron-alignment.mjs Check 5 flags both
-- directions of drift in CI and fails the build.
--
-- This migration formalizes the truth:
--   * Unschedule the three jobs that no longer exist in live so the
--     validator no longer reports them as MISSING. Wrapped in
--     DO/EXCEPTION blocks because cron.unschedule() throws if the
--     job doesn't exist (true on any DB where these never ran).
--   * Re-create monitor-instagram-2h with the exact command + schedule
--     observed in cron.job today, so the validator manifest matches
--     live and the GHOST flag clears. cron.schedule() upserts on the
--     job name, so running this against the existing live job is a
--     no-op when content matches.
--
-- Idempotent. Safe to re-run.

-- ── Removed jobs ──
-- fortress-qa-6h: removed after the QA agent contamination incident
-- (May 7 2026) — function deactivated, no replacement scheduled.
DO $$ BEGIN
  PERFORM cron.unschedule('fortress-qa-6h');
EXCEPTION WHEN OTHERS THEN
  -- Already absent — fine.
  NULL;
END $$;

-- monitor-twitter-30min: paused under Phase X-1 budget controls;
-- replaced by per-tenant monitor-x-single under event-flag gating.
DO $$ BEGIN
  PERFORM cron.unschedule('monitor-twitter-30min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- self-improvement-nightly: declared in an earlier migration but the
-- live schedule was removed when the function was consolidated into
-- self-improvement-orchestrator (now scheduled as
-- 'self-improvement-nightly' via the orchestrator's own migration).
DO $$ BEGIN
  PERFORM cron.unschedule('self-improvement-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── Reinstated/formalized jobs ──
-- monitor-instagram-2h: command matches the existing live job exactly;
-- this migration just brings it under version control.
SELECT cron.schedule(
  'monitor-instagram-2h',
  '17 */2 * * *',
  $$
    SELECT net.http_post(
      url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-instagram',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.get_current_service_role_key(),
        'apikey', public.get_current_service_role_key()
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 170000
    );
  $$
);
