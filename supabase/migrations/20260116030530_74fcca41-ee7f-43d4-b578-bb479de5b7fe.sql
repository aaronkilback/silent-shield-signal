-- Briefing Sessions table - for organizing investigative briefings
CREATE TABLE public.briefing_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  scheduled_start TIMESTAMP WITH TIME ZONE,
  actual_start TIMESTAMP WITH TIME ZONE,
  actual_end TIMESTAMP WITH TIME ZONE,
  facilitator_user_id UUID REFERENCES auth.users(id),
  meeting_mode TEXT DEFAULT 'collaborative' CHECK (meeting_mode IN ('presenter', 'collaborative')),
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing Agenda Items
CREATE TABLE public.briefing_agenda_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  presenter_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing Decisions - formal record of decisions made
CREATE TABLE public.briefing_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
  decision_text TEXT NOT NULL,
  rationale TEXT,
  decision_maker_user_id UUID REFERENCES auth.users(id),
  decision_maker_agent_id UUID REFERENCES public.ai_agents(id),
  category TEXT DEFAULT 'general' CHECK (category IN ('general', 'tactical', 'resource', 'escalation', 'policy')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'implemented')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing Notes - structured notes and parking lot items
CREATE TABLE public.briefing_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'discussion' CHECK (note_type IN ('discussion', 'observation', 'parking_lot', 'action_item', 'question')),
  topic TEXT,
  author_user_id UUID REFERENCES auth.users(id),
  author_agent_id UUID REFERENCES public.ai_agents(id),
  is_highlighted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COP Timeline Events - events for the Common Operating Picture
CREATE TABLE public.cop_timeline_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  event_time TIMESTAMP WITH TIME ZONE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT DEFAULT 'general' CHECK (event_type IN ('signal', 'incident', 'task', 'decision', 'evidence', 'entity', 'general', 'milestone')),
  source_type TEXT, -- 'signal', 'incident', 'task', 'manual'
  source_id UUID, -- reference to the source record
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  metadata JSONB DEFAULT '{}'::jsonb,
  added_by_user_id UUID REFERENCES auth.users(id),
  added_by_agent_id UUID REFERENCES public.ai_agents(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COP Entity Links - relationship graph data
CREATE TABLE public.cop_entity_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  entity_a_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  entity_b_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  strength NUMERIC DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  description TEXT,
  evidence_ids UUID[] DEFAULT '{}',
  discovered_by_user_id UUID REFERENCES auth.users(id),
  discovered_by_agent_id UUID REFERENCES public.ai_agents(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, entity_a_id, entity_b_id, relationship_type)
);

-- Evidence Locker - links evidence files to workspaces
CREATE TABLE public.workspace_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  storage_path TEXT NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  chain_of_custody JSONB DEFAULT '[]'::jsonb,
  linked_entity_ids UUID[] DEFAULT '{}',
  linked_timeline_event_ids UUID[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  uploaded_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COP Widgets - customizable dashboard widgets
CREATE TABLE public.cop_widgets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('summary', 'entity_list', 'metric', 'chart', 'notes', 'custom')),
  title TEXT NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  width INTEGER DEFAULT 1,
  height INTEGER DEFAULT 1,
  is_visible BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Briefing Participants - track who's in the briefing
CREATE TABLE public.briefing_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  agent_id UUID REFERENCES public.ai_agents(id),
  role TEXT DEFAULT 'participant' CHECK (role IN ('facilitator', 'presenter', 'participant', 'observer')),
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  left_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(briefing_id, user_id),
  UNIQUE(briefing_id, agent_id)
);

-- Enable RLS on all tables
ALTER TABLE public.briefing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cop_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cop_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cop_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_participants ENABLE ROW LEVEL SECURITY;

-- RLS Policies - based on workspace membership
CREATE POLICY "Workspace members can view briefing sessions"
ON public.briefing_sessions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = briefing_sessions.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can create briefing sessions"
ON public.briefing_sessions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = briefing_sessions.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can update briefing sessions"
ON public.briefing_sessions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = briefing_sessions.workspace_id
    AND wm.user_id = auth.uid()
  )
);

-- Similar policies for other tables
CREATE POLICY "Workspace members can manage agenda items"
ON public.briefing_agenda_items FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.briefing_sessions bs
    JOIN public.workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_agenda_items.briefing_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage decisions"
ON public.briefing_decisions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.briefing_sessions bs
    JOIN public.workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_decisions.briefing_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage notes"
ON public.briefing_notes FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.briefing_sessions bs
    JOIN public.workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_notes.briefing_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage COP timeline"
ON public.cop_timeline_events FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = cop_timeline_events.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage entity links"
ON public.cop_entity_links FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = cop_entity_links.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage evidence"
ON public.workspace_evidence FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_evidence.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage widgets"
ON public.cop_widgets FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = cop_widgets.workspace_id
    AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can manage participants"
ON public.briefing_participants FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.briefing_sessions bs
    JOIN public.workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_participants.briefing_id
    AND wm.user_id = auth.uid()
  )
);

-- Enable realtime for collaborative features
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cop_timeline_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_participants;

-- Updated_at triggers
CREATE TRIGGER update_briefing_sessions_updated_at
BEFORE UPDATE ON public.briefing_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_briefing_decisions_updated_at
BEFORE UPDATE ON public.briefing_decisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_briefing_notes_updated_at
BEFORE UPDATE ON public.briefing_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cop_entity_links_updated_at
BEFORE UPDATE ON public.cop_entity_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_evidence_updated_at
BEFORE UPDATE ON public.workspace_evidence
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cop_widgets_updated_at
BEFORE UPDATE ON public.cop_widgets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_briefing_sessions_workspace ON public.briefing_sessions(workspace_id);
CREATE INDEX idx_briefing_agenda_items_briefing ON public.briefing_agenda_items(briefing_id);
CREATE INDEX idx_briefing_decisions_briefing ON public.briefing_decisions(briefing_id);
CREATE INDEX idx_briefing_notes_briefing ON public.briefing_notes(briefing_id);
CREATE INDEX idx_cop_timeline_workspace ON public.cop_timeline_events(workspace_id);
CREATE INDEX idx_cop_timeline_event_time ON public.cop_timeline_events(event_time);
CREATE INDEX idx_cop_entity_links_workspace ON public.cop_entity_links(workspace_id);
CREATE INDEX idx_workspace_evidence_workspace ON public.workspace_evidence(workspace_id);
CREATE INDEX idx_cop_widgets_workspace ON public.cop_widgets(workspace_id);
CREATE INDEX idx_briefing_participants_briefing ON public.briefing_participants(briefing_id);