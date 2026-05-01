-- Agent action capability with permission tiers.
--
-- Today agents reason and consult but cannot DO anything in the world. The
-- platform has been gated on humans for every action. This table is the
-- ledger for AI-initiated actions, with three tiers:
--
--   AUTO: agent acts immediately. Bounded scope, low blast radius.
--         (e.g. file_followup_task, schedule_entity_rescan).
--   PROPOSE: agent proposes an action, an analyst approves before it runs.
--           Used for medium-blast-radius operations.
--           (e.g. propose_severity_correction, notify_oncall_via_slack).
--   READONLY: never executed automatically; agent cannot trigger this tier
--             at all. Reserved for explicitly human-only actions.
--
-- Every action goes here regardless of tier so we have a queryable trail of
-- "what did the AI try to do?" — analysts can audit, override, or revoke.

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who proposed it
  agent_call_sign text NOT NULL,
  -- What kind: file_followup_task, propose_severity_correction, etc.
  action_type     text NOT NULL,
  -- The actual payload — shape depends on action_type
  action_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Permission tier — determines workflow
  permission_tier text NOT NULL CHECK (permission_tier IN ('auto', 'propose', 'readonly')),
  -- Lifecycle
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'auto_executing', 'awaiting_approval', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  -- Why
  rationale       text,
  context_signal_id  uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  context_incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
  -- Approval / execution
  approved_by     uuid,
  approved_at     timestamptz,
  rejected_by     uuid,
  rejected_at     timestamptz,
  rejection_reason text,
  executed_at     timestamptz,
  execution_result jsonb,
  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_status_tier
  ON public.agent_actions (status, permission_tier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_signal
  ON public.agent_actions (context_signal_id, created_at DESC) WHERE context_signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending
  ON public.agent_actions (created_at) WHERE status IN ('pending', 'awaiting_approval');

-- Operator-friendly view: what's awaiting analyst approval right now?
CREATE OR REPLACE VIEW public.agent_actions_awaiting_approval AS
SELECT
  a.id,
  a.agent_call_sign,
  a.action_type,
  a.action_payload,
  a.rationale,
  a.context_signal_id,
  a.context_incident_id,
  s.title AS signal_title,
  a.created_at
FROM public.agent_actions a
LEFT JOIN public.signals s ON s.id = a.context_signal_id
WHERE a.status = 'awaiting_approval'
ORDER BY a.created_at DESC;

-- 24h activity rollup
CREATE OR REPLACE VIEW public.agent_actions_24h AS
SELECT
  agent_call_sign,
  action_type,
  permission_tier,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status = 'executed')::int AS executed,
  COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
  COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
  COUNT(*) FILTER (WHERE status IN ('pending','awaiting_approval'))::int AS pending
FROM public.agent_actions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_call_sign, action_type, permission_tier
ORDER BY total DESC;

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_actions_super_admin_all" ON public.agent_actions;
CREATE POLICY "agent_actions_super_admin_all" ON public.agent_actions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "agent_actions_service_role_all" ON public.agent_actions;
CREATE POLICY "agent_actions_service_role_all" ON public.agent_actions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.agent_actions IS
  'Ledger of AI-initiated actions with permission tiers. AUTO actions execute immediately and record result. PROPOSE actions await analyst approval before execution. READONLY actions are reserved for human-only operations.';
