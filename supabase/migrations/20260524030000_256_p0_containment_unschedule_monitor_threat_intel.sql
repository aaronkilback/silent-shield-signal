-- ════════════════════════════════════════════════════════════════════════════
-- #256 P0 CONTAINMENT (2026-05-23) — unschedule monitor-threat-intel cron.
--
-- REASON
--   monitor-threat-intel invokes ingest-signal WITHOUT client_id, which routes
--   through the cross-tenant scoring loop at supabase/functions/ingest-signal/
--   index.ts:914-996. Empirical evidence: 3 prod CISA-KEV signals (Apr 14–28)
--   silently misattributed to Petronas Canada despite being generic
--   infrastructure CVEs. Cron runs every ~15 min so contamination would
--   continue accruing throughout the architectural review window.
--
-- POSTURE
--   - Removes cron schedule via cron.unschedule() (same pattern as PROD-M X
--     retirement)
--   - Function code at supabase/functions/monitor-threat-intel/ remains
--     deployed; only the scheduler trigger is removed
--   - Function can still be manually invoked for debug if needed
--   - cron_job_registry row updated to reflect disabled status + reason
--     (kept so watchdog has a record of why it's not running)
--
-- REVERSAL (after #256 remediation lands)
--   SELECT cron.schedule(
--     'monitor-threat-intel',
--     '10,25,40,55 * * * *',
--     $$SELECT net.http_post(
--         url := '<staging-or-prod-fns-base>/monitor-threat-intel',
--         headers := jsonb_build_object('Authorization', 'Bearer <key>',
--                                       'Content-Type', 'application/json')
--       )$$
--   );
--   UPDATE cron_job_registry SET is_critical=true,
--     description='Threat intelligence feeds'
--     WHERE job_name='monitor-threat-intel';
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_jobid bigint;
  v_active boolean;
BEGIN
  SELECT jobid, active INTO v_jobid, v_active
  FROM cron.job WHERE jobname = 'monitor-threat-intel';

  IF v_jobid IS NULL THEN
    RAISE NOTICE '#256 containment: no cron.job named monitor-threat-intel — already disabled or never scheduled here';
  ELSE
    PERFORM cron.unschedule(v_jobid);
    RAISE NOTICE '#256 containment: unscheduled cron job % (monitor-threat-intel), was active=%', v_jobid, v_active;
  END IF;
END $$;

UPDATE cron_job_registry
SET is_critical = false,
    description = 'DISABLED 2026-05-23 (#256 P0 containment — cross-tenant misattribution via no-client_id ingest path; was every ~15min). Re-enable after ingest-signal contract hardening lands.'
WHERE job_name = 'monitor-threat-intel';

-- Verification: confirm the cron schedule is gone.
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname = 'monitor-threat-intel';
  IF v_count > 0 THEN
    RAISE EXCEPTION '#256 containment FAILED: cron.job monitor-threat-intel still exists post-unschedule';
  END IF;
  RAISE NOTICE '#256 containment verification OK: cron.job monitor-threat-intel removed';
END $$;
