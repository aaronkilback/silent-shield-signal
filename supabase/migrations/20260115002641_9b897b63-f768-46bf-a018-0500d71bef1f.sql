-- Briefing Queries Table: Stores questions asked about mission briefings
CREATE TABLE public.briefing_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES public.task_force_missions(id) ON DELETE CASCADE,
  asked_by UUID NOT NULL REFERENCES auth.users(id),
  question TEXT NOT NULL,
  ai_response TEXT,
  ai_confidence NUMERIC(3,2), -- 0.00 to 1.00
  ai_responded_at TIMESTAMP WITH TIME ZONE,
  escalation_status TEXT DEFAULT 'none' CHECK (escalation_status IN ('none', 'pending', 'responded')),
  escalated_at TIMESTAMP WITH TIME ZONE,
  escalated_to UUID REFERENCES auth.users(id), -- Mission creator
  human_response TEXT,
  human_responded_at TIMESTAMP WITH TIME ZONE,
  human_responded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing Query Sources: Links queries to source intelligence
CREATE TABLE public.briefing_query_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id UUID NOT NULL REFERENCES public.briefing_queries(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('signal', 'incident', 'agent_report', 'entity', 'document')),
  source_id UUID NOT NULL,
  source_title TEXT,
  source_excerpt TEXT,
  relevance_score NUMERIC(3,2), -- 0.00 to 1.00
  agent_attribution TEXT, -- e.g., "Locus-Intel", "Lex-Magna"
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_briefing_queries_mission ON public.briefing_queries(mission_id);
CREATE INDEX idx_briefing_queries_asked_by ON public.briefing_queries(asked_by);
CREATE INDEX idx_briefing_queries_escalation ON public.briefing_queries(escalation_status) WHERE escalation_status = 'pending';
CREATE INDEX idx_briefing_query_sources_query ON public.briefing_query_sources(query_id);
CREATE INDEX idx_briefing_query_sources_source ON public.briefing_query_sources(source_type, source_id);

-- Enable RLS
ALTER TABLE public.briefing_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_query_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies for briefing_queries
CREATE POLICY "Users can view queries for missions they have access to"
ON public.briefing_queries FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.task_force_missions m
    WHERE m.id = mission_id
    AND (m.created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin', 'analyst')
    ))
  )
);

CREATE POLICY "Users can create queries on missions they can access"
ON public.briefing_queries FOR INSERT
WITH CHECK (
  asked_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.task_force_missions m
    WHERE m.id = mission_id
  )
);

CREATE POLICY "Users can update their own queries or respond to escalations"
ON public.briefing_queries FOR UPDATE
USING (
  asked_by = auth.uid() OR 
  escalated_to = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- RLS Policies for briefing_query_sources
CREATE POLICY "Users can view sources for queries they can access"
ON public.briefing_query_sources FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.briefing_queries q
    WHERE q.id = query_id
    AND (q.asked_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin', 'analyst')
    ))
  )
);

CREATE POLICY "System can insert sources"
ON public.briefing_query_sources FOR INSERT
WITH CHECK (true);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_queries;

-- Update trigger
CREATE TRIGGER update_briefing_queries_updated_at
BEFORE UPDATE ON public.briefing_queries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();