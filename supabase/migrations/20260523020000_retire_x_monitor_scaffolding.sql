-- ════════════════════════════════════════════════════════════════════════════
-- PROD-M Option B (2026-05-22) — retire dead X monitor scaffolding
--
-- Diagnosis (full report in conversation history, summary below):
--
--   * monitor-twitter-30min  — cron created 2026-04-23, paused 2026-05-19
--                              under "Phase X-1 budget controls". Lifetime
--                              heartbeats: 0. Lifetime signals: 0.
--   * monitor-x-crt-bcplace-event — orphan cron pointing at
--                              /functions/v1/monitor-x-single, which
--                              does NOT exist in the repo. Inactive.
--   * monitor-x-petronas-daily — same orphan target. Inactive.
--   * cron_job_registry row 'monitor-twitter-30min' — interval=30,
--                              critical=false; would re-introduce
--                              false-positive surface if the cron is
--                              ever resurrected by mistake.
--
-- This migration retires the scheduler / registry scaffolding only.
-- The function code at supabase/functions/monitor-twitter/index.ts is
-- intentionally preserved as inventory:
--
--   * Already rewritten in April from broken Google CSE → real
--     Twitter API v2 (GET /2/tweets/search/recent).
--   * Defensively no-ops when TWITTER_BEARER_TOKEN is absent.
--   * Re-enable path (when X budget is funded again):
--       1. set TWITTER_BEARER_TOKEN secret
--       2. write a new migration to re-schedule cron + register in
--          cron_job_registry (deliberate, not silent)
--
-- Scope:
--   * cron.job        — 3 inactive rows removed
--   * cron_job_registry — 1 row removed
--   * No function deploy, no code change in this migration
--
-- Companion patch (separate diff in this PR, NOT in this migration):
--   * system-watchdog/index.ts — remove monitor-twitter from the
--     QUIET_MONITORS_OK set, the SOCIAL_ALREADY_CHECKED set, the
--     socialHeartbeats query, and the CRON_TO_AGENT mapping.
--   * scripts/validate-cron-alignment.mjs — update the
--     HEARTBEAT_NO_CRON_ALLOWLIST description to reflect retired
--     status (the entry stays — the function still writes a heartbeat).
--   * CLAUDE.md — update Twitter API v2 section to reflect retirement.
--
-- Rollback path:
--   * Re-run migration 20260423000012_schedule_twitter_monitor.sql
--     (creates the monitor-twitter-30min cron and registry entry).
--   * The two monitor-x-* orphan crons are deliberately NOT restorable
--     from a single migration — they pointed at a non-existent function
--     and should be re-created in the new architecture if/when needed.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_twitter_jobid bigint;
  v_bcplace_jobid bigint;
  v_petronas_jobid bigint;
BEGIN
  SELECT jobid INTO v_twitter_jobid FROM cron.job WHERE jobname = 'monitor-twitter-30min';
  IF v_twitter_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_twitter_jobid);
    RAISE NOTICE 'PROD-M: unscheduled monitor-twitter-30min (jobid=%)', v_twitter_jobid;
  END IF;

  SELECT jobid INTO v_bcplace_jobid FROM cron.job WHERE jobname = 'monitor-x-crt-bcplace-event';
  IF v_bcplace_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_bcplace_jobid);
    RAISE NOTICE 'PROD-M: unscheduled monitor-x-crt-bcplace-event (jobid=%)', v_bcplace_jobid;
  END IF;

  SELECT jobid INTO v_petronas_jobid FROM cron.job WHERE jobname = 'monitor-x-petronas-daily';
  IF v_petronas_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_petronas_jobid);
    RAISE NOTICE 'PROD-M: unscheduled monitor-x-petronas-daily (jobid=%)', v_petronas_jobid;
  END IF;
END $$;

DELETE FROM public.cron_job_registry WHERE job_name = 'monitor-twitter-30min';

-- Sanity assertion: no X-monitor cron jobs remain, no X-monitor registry entries remain.
DO $$
DECLARE
  v_cron_left int;
  v_registry_left int;
BEGIN
  SELECT count(*) INTO v_cron_left
  FROM cron.job
  WHERE jobname IN ('monitor-twitter-30min', 'monitor-x-crt-bcplace-event', 'monitor-x-petronas-daily');

  SELECT count(*) INTO v_registry_left
  FROM public.cron_job_registry
  WHERE job_name = 'monitor-twitter-30min';

  IF v_cron_left <> 0 OR v_registry_left <> 0 THEN
    RAISE EXCEPTION 'PROD-M invariant failed: cron remaining=% registry remaining=%',
      v_cron_left, v_registry_left;
  END IF;

  RAISE NOTICE 'PROD-M retirement verified — 0 X-monitor cron rows, 0 X-monitor registry rows.';
END $$;
