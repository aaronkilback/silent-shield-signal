
-- Table for agent-proposed monitoring changes (keywords, sources, entities)
CREATE TABLE public.monitoring_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('add_keyword', 'remove_keyword', 'add_source', 'update_source', 'add_entity')),
  proposed_value TEXT NOT NULL,
  proposed_by_agent TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  confidence NUMERIC DEFAULT 0.5,
  source_evidence JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'expired')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.monitoring_proposals ENABLE ROW LEVEL SECURITY;

-- Policies: analysts+ can view and manage proposals for their clients
CREATE POLICY "Authenticated users can view proposals"
  ON public.monitoring_proposals FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can update proposals"
  ON public.monitoring_proposals FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role) OR
    is_super_admin(auth.uid())
  );

CREATE POLICY "Service role can insert proposals"
  ON public.monitoring_proposals FOR INSERT
  WITH CHECK (true);

-- Index for efficient querying
CREATE INDEX idx_monitoring_proposals_status ON public.monitoring_proposals(status);
CREATE INDEX idx_monitoring_proposals_client ON public.monitoring_proposals(client_id);

-- Trigger for updated_at
CREATE TRIGGER update_monitoring_proposals_updated_at
  BEFORE UPDATE ON public.monitoring_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live updates in UI
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitoring_proposals;
