-- =====================================================
-- FIX: Infinite Recursion in workspace_members RLS
-- =====================================================

-- 1. Create security definer function to check workspace membership
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  )
$$;

-- 2. Create function to check if user is workspace owner
CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id AND role = 'owner'
  )
$$;

-- 3. Create function to check if user is contributor or owner
CREATE OR REPLACE FUNCTION public.is_workspace_contributor(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id AND role IN ('owner', 'contributor')
  )
$$;

-- =====================================================
-- DROP OLD POLICIES
-- =====================================================
DROP POLICY IF EXISTS "Members can view their workspaces" ON public.investigation_workspaces;
DROP POLICY IF EXISTS "Owners can update workspaces" ON public.investigation_workspaces;
DROP POLICY IF EXISTS "Members can view workspace members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can add members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can remove members" ON public.workspace_members;
DROP POLICY IF EXISTS "Members can view workspace messages" ON public.workspace_messages;
DROP POLICY IF EXISTS "Contributors can send messages" ON public.workspace_messages;
DROP POLICY IF EXISTS "Members can view workspace tasks" ON public.workspace_tasks;
DROP POLICY IF EXISTS "Contributors can create tasks" ON public.workspace_tasks;
DROP POLICY IF EXISTS "Contributors can update tasks" ON public.workspace_tasks;
DROP POLICY IF EXISTS "Members can view workspace audit logs" ON public.workspace_audit_log;

-- =====================================================
-- RECREATE POLICIES WITH SECURITY DEFINER FUNCTIONS
-- =====================================================

-- investigation_workspaces policies
CREATE POLICY "Members can view their workspaces"
  ON public.investigation_workspaces FOR SELECT
  USING (public.is_workspace_member(id, auth.uid()));

CREATE POLICY "Owners can update workspaces"
  ON public.investigation_workspaces FOR UPDATE
  USING (public.is_workspace_owner(id, auth.uid()));

-- workspace_members policies
CREATE POLICY "Members can view workspace members"
  ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Owners can add members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR (user_id = auth.uid() AND role = 'owner')
  );

CREATE POLICY "Owners can remove members"
  ON public.workspace_members FOR DELETE
  USING (public.is_workspace_owner(workspace_id, auth.uid()));

-- workspace_messages policies
CREATE POLICY "Members can view workspace messages"
  ON public.workspace_messages FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Contributors can send messages"
  ON public.workspace_messages FOR INSERT
  WITH CHECK (
    public.is_workspace_contributor(workspace_id, auth.uid())
    AND user_id = auth.uid()
  );

-- workspace_tasks policies
CREATE POLICY "Members can view workspace tasks"
  ON public.workspace_tasks FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Contributors can create tasks"
  ON public.workspace_tasks FOR INSERT
  WITH CHECK (
    public.is_workspace_contributor(workspace_id, auth.uid())
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "Contributors can update tasks"
  ON public.workspace_tasks FOR UPDATE
  USING (public.is_workspace_contributor(workspace_id, auth.uid()));

-- workspace_audit_log policies
CREATE POLICY "Members can view workspace audit logs"
  ON public.workspace_audit_log FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));