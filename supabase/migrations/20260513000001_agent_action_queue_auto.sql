-- ============================================================
--  Agent Action Queue — auto-execute on consensus + stale window
--  2026-05-13: Aaron is a one-person operation. The queue assumes
--  analyst capacity that doesn't exist. Make it management-by-
--  exception instead of management-by-review.
-- ============================================================

-- Severity ordering helper (lower = more severe in operator terms;
-- "critical" > "high" > "medium" > "low" > "info"). Used to decide
-- whether a proposed change is a downgrade (safe direction, can
-- default-approve) or upgrade (always requires operator).
CREATE OR REPLACE FUNCTION public.severity_rank(s text)
 RETURNS int
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT CASE LOWER(COALESCE(s,''))
    WHEN 'critical' THEN 5
    WHEN 'high'     THEN 4
    WHEN 'medium'   THEN 3
    WHEN 'low'      THEN 2
    WHEN 'info'     THEN 1
    ELSE 0 END;
$$;

-- Apply a single queued action. Idempotent — if already executed,
-- no-op. Returns true on success, false if action not actionable.
CREATE OR REPLACE FUNCTION public.apply_agent_action(p_action_id uuid, p_reason text DEFAULT 'auto')
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  a record;
  result_note jsonb;
BEGIN
  SELECT * INTO a FROM agent_actions WHERE id = p_action_id;
  IF NOT FOUND OR a.status = 'executed' THEN RETURN false; END IF;

  CASE a.action_type
    WHEN 'propose_severity_correction' THEN
      IF a.context_signal_id IS NOT NULL AND a.action_payload->>'proposed_severity' IS NOT NULL THEN
        UPDATE signals SET severity = a.action_payload->>'proposed_severity'
        WHERE id = a.context_signal_id::uuid
          AND severity IS DISTINCT FROM (a.action_payload->>'proposed_severity');
      END IF;
    WHEN 'flag_false_positive' THEN
      IF a.context_signal_id IS NOT NULL THEN
        UPDATE signals SET status = 'false_positive'
        WHERE id = a.context_signal_id::uuid AND status != 'false_positive';
      END IF;
    WHEN 'dismiss_signal' THEN
      IF a.context_signal_id IS NOT NULL THEN
        UPDATE signals SET status = 'archived'
        WHERE id = a.context_signal_id::uuid AND status != 'archived';
      END IF;
    ELSE
      -- Unknown action_type: mark as executed but don't apply
      result_note := jsonb_build_object('warning', 'unknown action_type — marked executed without applying', 'reason', p_reason);
  END CASE;

  UPDATE agent_actions
  SET status = 'executed',
      approved_at = NOW(),
      executed_at = NOW(),
      execution_result = COALESCE(result_note, jsonb_build_object('reason', p_reason, 'applied_at', NOW()))
  WHERE id = p_action_id;

  RETURN true;
END;
$$;

-- ============================================================
--  OPTION A — auto-execute on agent consensus
--
--  When a new propose-tier action lands, if 2+ separate actions
--  now exist proposing the same change on the same signal, auto-
--  execute all of them. Two independent agents agreeing is stronger
--  evidence than one operator's gut call.
-- ============================================================
CREATE OR REPLACE FUNCTION public.agent_action_consensus_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  match_count int;
  match_id uuid;
BEGIN
  -- Only auto-execute consensus on these action types
  IF NEW.action_type NOT IN ('propose_severity_correction', 'flag_false_positive', 'dismiss_signal') THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'awaiting_approval' THEN RETURN NEW; END IF;

  -- Count peers: same signal, same action_type, same proposed value
  SELECT COUNT(*) INTO match_count
  FROM agent_actions
  WHERE status = 'awaiting_approval'
    AND action_type = NEW.action_type
    AND context_signal_id = NEW.context_signal_id
    AND COALESCE(action_payload->>'proposed_severity', '') = COALESCE(NEW.action_payload->>'proposed_severity', '')
    AND id != NEW.id;

  IF match_count >= 1 THEN
    -- Consensus reached. Auto-execute this new one + all matching peers.
    PERFORM public.apply_agent_action(NEW.id, 'auto-consensus');
    FOR match_id IN
      SELECT id FROM agent_actions
      WHERE status = 'awaiting_approval'
        AND action_type = NEW.action_type
        AND context_signal_id = NEW.context_signal_id
        AND COALESCE(action_payload->>'proposed_severity', '') = COALESCE(NEW.action_payload->>'proposed_severity', '')
    LOOP
      PERFORM public.apply_agent_action(match_id, 'auto-consensus');
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_action_consensus_trigger ON agent_actions;
CREATE TRIGGER agent_action_consensus_trigger
  AFTER INSERT ON agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.agent_action_consensus_check();

-- ============================================================
--  OPTION B — default-approve safe directions after 24h
--
--  Severity downgrades and dismissals are the lower-risk direction.
--  If they've sat unreviewed for 24h, default-approve. Pages,
--  incident escalations, severity UPGRADES still wait indefinitely.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_approve_safe_actions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  approved_count int := 0;
  action_id uuid;
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

  RETURN jsonb_build_object('approved', approved_count, 'ran_at', NOW());
END;
$$;

-- Schedule the auto-approve sweep hourly
SELECT cron.unschedule('agent-action-auto-approve-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-action-auto-approve-hourly');

SELECT cron.schedule(
  'agent-action-auto-approve-hourly',
  '23 * * * *',
  $cron$ SELECT public.auto_approve_safe_actions(); $cron$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('agent-action-auto-approve-hourly', 60, 'Auto-approve stale safe-direction agent actions (downgrades/dismissals after 24h)', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description;

-- Final state — show what landed
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'apply_agent_action') AS apply_fn,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'agent_action_consensus_check') AS consensus_fn,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'auto_approve_safe_actions') AS auto_approve_fn,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'agent_action_consensus_trigger') AS trigger_installed,
  (SELECT active FROM cron.job WHERE jobname = 'agent-action-auto-approve-hourly') AS cron_active;
