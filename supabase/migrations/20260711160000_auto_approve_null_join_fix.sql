-- ============================================================
--  Fix: auto_approve_safe_actions INNER-JOIN NULL-context defect
--
--  BEFORE (20260513180000_auto_approve_heartbeat, currently prod):
--    JOIN signals s ON s.id = aa.context_signal_id::uuid
--    → NULL-context rows silently excluded from consideration
--    for 48+ days.
--
--  Confirmed 2026-07-11 during #215 disposition of 27 pending
--  actions: 18 of 27 had NULL context_signal_id. Same class as
--  the WO-DATA-INTEGRITY reports-orphan bug (INNER JOIN on
--  nullable FK silently drops rows). Watchdog line 3749 already
--  hypothesized this cause; #215 disposition proved it.
--
--  AFTER:
--    (1) LEFT JOIN + explicit `s.id IS NOT NULL` guard preserves
--        the current auto-approve safety (still only auto-approve
--        when the target signal exists AND direction is provably
--        downward).
--    (2) A third pass marks NULL-context / missing-target rows
--        with `target_missing=true` in action_payload so they
--        surface in the stuck-approval view instead of silently
--        accumulating.
--    (3) Heartbeat reporting from the 2026-05-13 version is
--        preserved so Monitor Health continues to see this job.
--
--  Ratified by operator 2026-07-11 (Task #213 as sibling to #215).
--  Enforcement token in DETAIL of the heartbeat + target_missing
--  payload marker for grep-ability:
--    WO_DATA_INTEGRITY_SIBLING_AUTO_APPROVE_NULL_JOIN_FIX_2026_07_11
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_approve_safe_actions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  approved_count int := 0;
  target_missing_count int := 0;
  action_id uuid;
  hb_started timestamptz := NOW();
BEGIN
  -- Pass 1: severity downgrades on REAL target signals.
  -- LEFT JOIN + explicit s.id IS NOT NULL means NULL-context /
  -- missing-target rows do not enter the auto-approve loop
  -- (we cannot verify safe direction without knowing current
  -- severity). They are handled by pass 3.
  FOR action_id IN
    SELECT aa.id
    FROM agent_actions aa
    LEFT JOIN signals s ON s.id = aa.context_signal_id::uuid
    WHERE aa.status = 'awaiting_approval'
      AND aa.action_type = 'propose_severity_correction'
      AND aa.created_at < NOW() - interval '24 hours'
      AND s.id IS NOT NULL
      AND public.severity_rank(aa.action_payload->>'proposed_severity')
          < public.severity_rank(s.severity)
  LOOP
    PERFORM public.apply_agent_action(action_id, 'auto-stale-downgrade');
    approved_count := approved_count + 1;
  END LOOP;

  -- Pass 2: false-positive flags / dismissals — no target dependency.
  -- Unchanged from prior version.
  FOR action_id IN
    SELECT id FROM agent_actions
    WHERE status = 'awaiting_approval'
      AND action_type IN ('flag_false_positive', 'dismiss_signal')
      AND created_at < NOW() - interval '24 hours'
  LOOP
    PERFORM public.apply_agent_action(action_id, 'auto-stale-safe');
    approved_count := approved_count + 1;
  END LOOP;

  -- Pass 3: NEW — mark severity-correction actions with NULL context
  -- or missing target signals as target_missing so they surface in
  -- a stuck-approval view. Do NOT auto-approve (cannot verify safe
  -- direction). Idempotent — skips rows already marked.
  WITH stuck AS (
    SELECT aa.id
    FROM agent_actions aa
    LEFT JOIN signals s ON s.id = aa.context_signal_id::uuid
    WHERE aa.status = 'awaiting_approval'
      AND aa.action_type = 'propose_severity_correction'
      AND aa.created_at < NOW() - interval '24 hours'
      AND s.id IS NULL
      AND (aa.action_payload->>'target_missing') IS NULL
  )
  UPDATE agent_actions
  SET action_payload = COALESCE(action_payload, '{}'::jsonb) || jsonb_build_object(
        'target_missing', true,
        'target_missing_reason', 'target_signal_null_or_soft_deleted_at_auto_approve_sweep',
        'target_missing_detected_at', NOW()::text,
        'auto_approve_deferred_because', 'cannot_verify_severity_direction_without_target',
        'enforcement_token', 'WO_DATA_INTEGRITY_SIBLING_AUTO_APPROVE_NULL_JOIN_FIX_2026_07_11'
      ),
      updated_at = NOW()
  WHERE id IN (SELECT id FROM stuck);
  GET DIAGNOSTICS target_missing_count = ROW_COUNT;

  -- Self-report to cron_heartbeat (preserved from 2026-05-13 version).
  INSERT INTO cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
  VALUES (
    'agent-action-auto-approve-hourly',
    hb_started,
    NOW(),
    'succeeded',
    EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
    jsonb_build_object(
      'approved_count', approved_count,
      'target_missing_flagged', target_missing_count,
      'enforcement_token', 'WO_DATA_INTEGRITY_SIBLING_AUTO_APPROVE_NULL_JOIN_FIX_2026_07_11'
    )
  );

  RETURN jsonb_build_object(
    'approved', approved_count,
    'target_missing_flagged', target_missing_count,
    'ran_at', NOW(),
    'enforcement_token', 'WO_DATA_INTEGRITY_SIBLING_AUTO_APPROVE_NULL_JOIN_FIX_2026_07_11'
  );
END;
$$;
