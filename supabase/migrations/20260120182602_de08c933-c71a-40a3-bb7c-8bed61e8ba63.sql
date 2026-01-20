-- Fix critical security issues: Workspace invitations, Source artifacts, AI agents

-- 1. Fix workspace_invitations: Only workspace owners and invited users can see invitations
DROP POLICY IF EXISTS "Workspace members can view invitations" ON public.workspace_invitations;
DROP POLICY IF EXISTS "Workspace invitations are viewable by workspace members" ON public.workspace_invitations;
DROP POLICY IF EXISTS "Anyone can view invitations" ON public.workspace_invitations;

CREATE POLICY "Users can view their own invitations or as workspace owners"
ON public.workspace_invitations
FOR SELECT
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  OR 
  invited_by = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_invitations.workspace_id
    AND wm.user_id = auth.uid()
    AND wm.role = 'owner'
  )
);

-- 2. Fix source_artifacts: Require authentication and proper access
DROP POLICY IF EXISTS "Anyone can view source artifacts" ON public.source_artifacts;
DROP POLICY IF EXISTS "Source artifacts are viewable by everyone" ON public.source_artifacts;
DROP POLICY IF EXISTS "Authenticated users can view source artifacts" ON public.source_artifacts;

CREATE POLICY "Authenticated users can view source artifacts"
ON public.source_artifacts
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- 3. Fix ai_agents: Restrict to authenticated users only
DROP POLICY IF EXISTS "Anyone can view AI agents" ON public.ai_agents;
DROP POLICY IF EXISTS "AI agents are viewable by everyone" ON public.ai_agents;
DROP POLICY IF EXISTS "Everyone can view active agents" ON public.ai_agents;

CREATE POLICY "Authenticated users can view AI agents"
ON public.ai_agents
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- 4. Fix INSERT/UPDATE/DELETE policies that use (true) - automation_metrics
DROP POLICY IF EXISTS "Anyone can insert automation metrics" ON public.automation_metrics;
DROP POLICY IF EXISTS "Anyone can update automation metrics" ON public.automation_metrics;

CREATE POLICY "System can insert automation metrics"
ON public.automation_metrics
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL OR current_setting('role', true) = 'service_role');

CREATE POLICY "System can update automation metrics"
ON public.automation_metrics
FOR UPDATE
USING (auth.uid() IS NOT NULL OR current_setting('role', true) = 'service_role');

-- 5. Fix blocked_terms - require authentication for modifications
DROP POLICY IF EXISTS "Anyone can insert blocked terms" ON public.blocked_terms;
DROP POLICY IF EXISTS "Anyone can update blocked terms" ON public.blocked_terms;
DROP POLICY IF EXISTS "Anyone can delete blocked terms" ON public.blocked_terms;

CREATE POLICY "Authenticated users can insert blocked terms"
ON public.blocked_terms
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update blocked terms"
ON public.blocked_terms
FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete blocked terms"
ON public.blocked_terms
FOR DELETE
USING (auth.uid() IS NOT NULL);