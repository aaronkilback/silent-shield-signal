-- 2026-05-13: auto_approve_safe_actions() runs hourly via pg_cron but never
-- wrote a cron_heartbeat row, so Monitor Health showed the job as "last: never"
-- (critical) even though cron.job_run_details confirmed it was succeeding every
-- run. Watchdog reads cron_heartbeat, not cron.job_run_details, so the SQL
-- function must self-report.

CREATE OR REPLACE FUNCTION public.auto_approve_safe_actions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  approved_count int := 0;
  action_id uuid;
  hb_started timestamptz := NOW();
BEGIN
  -- Severity downgrades that have aged past the window
  FOR action_id IN
    SELECT aa.id
    FROM agent_actions aa
    JOIN signals s ON s.id = aa.context_signal_id::uuid
    WHERE aa.status = 'awaiting_approval'
      AND aa.action_type = 'propose_severity_correction'
      AND aa.created_at < NOW() - interval '24 hours'
      AND public.severity_rank(aa.action_payload->>'proposed_severity')
          < public.severity_rank(s.severity)
  LOOP
    PERFORM public.apply_agent_action(action_id, 'auto-stale-downgrade');
    approved_count := approved_count + 1;
  END LOOP;

  -- False-positive flags / dismissals — same window
  FOR action_id IN
    SELECT id FROM agent_actions
    WHERE status = 'awaiting_approval'
      AND action_type IN ('flag_false_positive', 'dismiss_signal')
      AND created_at < NOW() - interval '24 hours'
  LOOP
    PERFORM public.apply_agent_action(action_id, 'auto-stale-safe');
    approved_count := approved_count + 1;
  END LOOP;

  -- Self-report to cron_heartbeat so Monitor Health can see this job.
  INSERT INTO cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
  VALUES (
    'agent-action-auto-approve-hourly',
    hb_started,
    NOW(),
    'succeeded',
    EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
    jsonb_build_object('approved_count', approved_count)
  );

  RETURN jsonb_build_object('approved', approved_count, 'ran_at', NOW());
END;
$$;
