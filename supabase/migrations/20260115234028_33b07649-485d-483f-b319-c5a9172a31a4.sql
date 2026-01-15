-- =====================================================
-- COLLABORATIVE INVESTIGATION WORKSPACE - MVP SCHEMA
-- =====================================================

-- 1. Investigation Workspaces Table
CREATE TABLE public.investigation_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  CONSTRAINT workspace_must_have_parent CHECK (incident_id IS NOT NULL OR investigation_id IS NOT NULL)
);

-- 2. Workspace Members Table (Junction)
CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor', 'viewer')),
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- 3. Workspace Messages Table
CREATE TABLE public.workspace_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  message_type TEXT NOT NULL DEFAULT 'chat' CHECK (message_type IN ('chat', 'system_event', 'note')),
  parent_message_id UUID REFERENCES public.workspace_messages(id) ON DELETE SET NULL
);

-- 4. Workspace Tasks Table
CREATE TABLE public.workspace_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_user_id UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- 5. Workspace Audit Log Table
CREATE TABLE public.workspace_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.investigation_workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  details JSONB,
  performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_workspaces_incident ON public.investigation_workspaces(incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_workspaces_investigation ON public.investigation_workspaces(investigation_id) WHERE investigation_id IS NOT NULL;
CREATE INDEX idx_workspaces_status ON public.investigation_workspaces(status);
CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX idx_workspace_messages_workspace ON public.workspace_messages(workspace_id, sent_at DESC);
CREATE INDEX idx_workspace_tasks_workspace ON public.workspace_tasks(workspace_id, status);
CREATE INDEX idx_workspace_tasks_assigned ON public.workspace_tasks(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_workspace_audit_workspace ON public.workspace_audit_log(workspace_id, performed_at DESC);

-- =====================================================
-- ENABLE ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.investigation_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_audit_log ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES - investigation_workspaces
-- =====================================================
-- Members can view workspaces they belong to
CREATE POLICY "Members can view their workspaces"
  ON public.investigation_workspaces FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = id AND wm.user_id = auth.uid()
    )
  );

-- Authenticated users can create workspaces (must be admin/analyst)
CREATE POLICY "Authorized users can create workspaces"
  ON public.investigation_workspaces FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'analyst'))
  );

-- Owners can update their workspaces
CREATE POLICY "Owners can update workspaces"
  ON public.investigation_workspaces FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = id AND wm.user_id = auth.uid() AND wm.role = 'owner'
    )
  );

-- =====================================================
-- RLS POLICIES - workspace_members
-- =====================================================
-- Members can view other members of their workspaces
CREATE POLICY "Members can view workspace members"
  ON public.workspace_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid()
    )
  );

-- Owners can add members
CREATE POLICY "Owners can add members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.role = 'owner'
    )
    OR
    -- Allow initial owner to add themselves
    (user_id = auth.uid() AND role = 'owner')
  );

-- Owners can remove members
CREATE POLICY "Owners can remove members"
  ON public.workspace_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.role = 'owner'
    )
  );

-- =====================================================
-- RLS POLICIES - workspace_messages
-- =====================================================
-- Members can view messages in their workspaces
CREATE POLICY "Members can view workspace messages"
  ON public.workspace_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid()
    )
  );

-- Contributors and owners can send messages
CREATE POLICY "Contributors can send messages"
  ON public.workspace_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() 
      AND wm.role IN ('owner', 'contributor')
    )
    AND user_id = auth.uid()
  );

-- =====================================================
-- RLS POLICIES - workspace_tasks
-- =====================================================
-- Members can view tasks in their workspaces
CREATE POLICY "Members can view workspace tasks"
  ON public.workspace_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid()
    )
  );

-- Contributors and owners can create tasks
CREATE POLICY "Contributors can create tasks"
  ON public.workspace_tasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() 
      AND wm.role IN ('owner', 'contributor')
    )
    AND created_by_user_id = auth.uid()
  );

-- Contributors and owners can update tasks
CREATE POLICY "Contributors can update tasks"
  ON public.workspace_tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() 
      AND wm.role IN ('owner', 'contributor')
    )
  );

-- =====================================================
-- RLS POLICIES - workspace_audit_log
-- =====================================================
-- Members can view audit logs of their workspaces
CREATE POLICY "Members can view workspace audit logs"
  ON public.workspace_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid()
    )
  );

-- System inserts audit logs (via service role or triggers)
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.workspace_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- TRIGGERS
-- =====================================================
-- Update updated_at on workspace changes
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.investigation_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ENABLE REALTIME for messages
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_tasks;