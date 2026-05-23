-- ════════════════════════════════════════════════════════════════════════════
-- PROD-L (2026-05-22) — fix cron_job_registry key mismatch for job-worker
--
-- Symptom: neural constellation / system-watchdog flagged job-worker as
-- critical/stale ("last heartbeat 4 days ago"). Investigation showed
-- this was a false alarm caused by drift in cron_job_registry — the
-- actual job-worker has been firing every minute and draining the
-- function_jobs queue normally (4942 lifetime heartbeats on
-- 'job-worker-1min', last 2026-05-23 01:51:05 UTC).
--
-- Root cause: two prior interventions inverted the registry.
--
--   2026-05-04: the row job_name='job-worker-1min' was demoted to
--     expected_interval_minutes=525600 (one year) and is_critical=false,
--     with description "[DEMOTED ... no heartbeat in 30 days; likely
--     deprecated]". This was wrong — the deployed function had been
--     writing heartbeats with this exact name continuously since the
--     queue infrastructure landed (migration 20260430000005).
--
--   2026-05-19: a new row job_name='job-worker' was inserted at
--     expected_interval_minutes=1, is_critical=true, with description
--     "Heartbeat name is 'job-worker' — the registry previously had
--     'job-worker-1min' which never matched." The function was never
--     updated to write this name. After this row landed, the UI
--     correctly computed "last heartbeat 4 days ago" because nothing
--     in the deployed code ever wrote that heartbeat key.
--
-- Source of truth:
--   * cron.job.jobname           = 'job-worker-1min'
--   * cron.job.schedule          = '* * * * *'
--   * function_jobs queue worker = supabase/functions/job-worker/index.ts
--     line 46: startHeartbeat(supabase, 'job-worker-1min')
--
-- Fix: align the registry with the function and cron — single source of
-- truth is the deployed function. Do NOT rename the function or the cron;
-- both are operating correctly.
--
-- Scope: 2 rows in cron_job_registry. No function touch, no cron touch,
-- no watchdog regex change tonight. CI invariant + watchdog regex
-- tightening are deferred to a separate follow-up.
--
-- Rollback:
--   BEGIN;
--   UPDATE public.cron_job_registry
--   SET expected_interval_minutes = 525600,
--       is_critical = false
--   WHERE job_name = 'job-worker-1min';
--   INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, is_critical, description)
--   VALUES ('job-worker', 1, true, '[restored by rollback]');
--   COMMIT;
-- (Rollback is supplied for completeness — the pre-fix state was the
--  source of the false alarm, so the only reason to roll back would be
--  to deliberately re-introduce the bug for repro purposes.)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Remove the phantom row added 2026-05-19. Nothing in the deployed
--    code writes a heartbeat with this name; it is purely a registry
--    artifact and the source of the false alarm.
DELETE FROM public.cron_job_registry
WHERE job_name = 'job-worker';

-- 2. Restore truthful metadata on the row that corresponds to the
--    actively-firing heartbeat. This is what monitor-uptime checks +
--    the neural-constellation panel will join against from now on.
UPDATE public.cron_job_registry
SET expected_interval_minutes = 1,
    is_critical = true,
    description = 'Drains function_jobs queue every minute (durable async invocation for ai-decision-engine, ingest-signal, and similar). '
               || 'Heartbeat name is "job-worker-1min" — matches cron.job.jobname and the literal string in '
               || 'supabase/functions/job-worker/index.ts (startHeartbeat call). '
               || 'Do NOT rename in this table without updating the function in lock-step.'
WHERE job_name = 'job-worker-1min';

-- Sanity assertion: exactly one row for the worker, with the truthful state.
DO $$
DECLARE
  v_count int;
  v_row record;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.cron_job_registry
  WHERE job_name ILIKE 'job-worker%';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROD-L invariant failed: expected exactly 1 job-worker% row in cron_job_registry, found %', v_count;
  END IF;

  SELECT job_name, expected_interval_minutes, is_critical INTO v_row
  FROM public.cron_job_registry
  WHERE job_name ILIKE 'job-worker%';

  IF v_row.job_name <> 'job-worker-1min'
     OR v_row.expected_interval_minutes <> 1
     OR v_row.is_critical IS NOT TRUE THEN
    RAISE EXCEPTION 'PROD-L invariant failed: row state is (name=%, interval=%, critical=%), expected (job-worker-1min, 1, true)',
      v_row.job_name, v_row.expected_interval_minutes, v_row.is_critical;
  END IF;

  RAISE NOTICE 'PROD-L registry fix verified: job-worker-1min interval=% critical=%',
    v_row.expected_interval_minutes, v_row.is_critical;
END $$;

COMMIT;
