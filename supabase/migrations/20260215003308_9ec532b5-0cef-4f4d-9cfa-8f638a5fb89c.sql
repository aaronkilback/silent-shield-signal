
-- Investigation Autopilot Tasks table
CREATE TABLE public.investigation_autopilot_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL, -- 'entity_extraction', 'signal_crossref', 'pattern_matching', 'timeline_construction', 'risk_assessment', 'osint_lookup'
  task_label TEXT NOT NULL, -- Human-readable label
  agent_call_sign TEXT, -- Which specialist agent performed this
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'skipped'
  priority INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  -- Input context for the task
  input_context JSONB DEFAULT '{}'::jsonb,
  
  -- Results
  findings JSONB DEFAULT '[]'::jsonb, -- Array of finding objects
  summary TEXT, -- AI-generated summary of findings
  confidence_score NUMERIC(3,2), -- 0.00 to 1.00
  entities_found TEXT[] DEFAULT '{}',
  signals_correlated UUID[] DEFAULT '{}',
  
  -- Analyst review
  review_status TEXT DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected', 'needs_redirect'
  reviewer_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  
  -- Metadata
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Investigation Autopilot Sessions (groups tasks into a run)
CREATE TABLE public.investigation_autopilot_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'planning', -- 'planning', 'running', 'completed', 'paused', 'cancelled'
  
  -- AI planning
  task_plan JSONB DEFAULT '[]'::jsonb, -- Planned tasks before execution
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  
  -- Results
  overall_summary TEXT,
  risk_score NUMERIC(3,2),
  key_findings JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add session reference to tasks
ALTER TABLE public.investigation_autopilot_tasks
  ADD COLUMN session_id UUID REFERENCES public.investigation_autopilot_sessions(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.investigation_autopilot_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_autopilot_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for autopilot tasks (role-gated, authenticated users)
CREATE POLICY "Authenticated users can view autopilot tasks"
  ON public.investigation_autopilot_tasks
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Analysts and above can insert autopilot tasks"
  ON public.investigation_autopilot_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Analysts and above can update autopilot tasks"
  ON public.investigation_autopilot_tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  );

-- RLS policies for autopilot sessions
CREATE POLICY "Authenticated users can view autopilot sessions"
  ON public.investigation_autopilot_sessions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Analysts and above can insert autopilot sessions"
  ON public.investigation_autopilot_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Analysts and above can update autopilot sessions"
  ON public.investigation_autopilot_sessions
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analyst') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  );

-- Indexes
CREATE INDEX idx_autopilot_tasks_investigation ON public.investigation_autopilot_tasks(investigation_id);
CREATE INDEX idx_autopilot_tasks_session ON public.investigation_autopilot_tasks(session_id);
CREATE INDEX idx_autopilot_tasks_status ON public.investigation_autopilot_tasks(status);
CREATE INDEX idx_autopilot_sessions_investigation ON public.investigation_autopilot_sessions(investigation_id);
CREATE INDEX idx_autopilot_sessions_status ON public.investigation_autopilot_sessions(status);

-- Timestamp triggers
CREATE TRIGGER update_autopilot_tasks_updated_at
  BEFORE UPDATE ON public.investigation_autopilot_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_autopilot_sessions_updated_at
  BEFORE UPDATE ON public.investigation_autopilot_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.investigation_autopilot_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.investigation_autopilot_sessions;
