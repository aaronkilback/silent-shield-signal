-- Agent mission tasking system
-- Allows assigning explicit short-term objectives to agents with deadlines,
-- reporting cadence, and progress tracking.

CREATE TABLE IF NOT EXISTS public.agent_missions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  objective text NOT NULL,
  assigned_agent text NOT NULL,              -- agent call_sign
  assigned_by text,                          -- user_id, 'AEGIS', or 'system'
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
  deadline timestamptz,
  reporting_cadence text NOT NULL DEFAULT 'on_finding'
    CHECK (reporting_cadence IN ('on_finding', 'daily', 'weekly')),
  progress_log jsonb NOT NULL DEFAULT '[]', -- array of {date, update, finding_type}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_missions_agent_status
  ON public.agent_missions (assigned_agent, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agent_missions_client
  ON public.agent_missions (client_id)
  WHERE client_id IS NOT NULL;

-- RLS
ALTER TABLE public.agent_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_missions"
  ON public.agent_missions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read agent_missions"
  ON public.agent_missions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can create agent_missions"
  ON public.agent_missions FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update agent_missions"
  ON public.agent_missions FOR UPDATE
  TO authenticated USING (true);

COMMENT ON TABLE public.agent_missions IS 'Explicit short-term objectives assigned to agents with deadlines and progress tracking';
