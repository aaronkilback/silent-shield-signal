-- Fix the INSERT policy for investigation_workspaces
-- The issue: the current INSERT policy checks if user is a workspace member,
-- but they can't be a member until after the workspace is created

-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "Workspace members can insert workspaces" ON public.investigation_workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.investigation_workspaces;

-- Create a proper INSERT policy: authenticated users can create workspaces where they are the creator
CREATE POLICY "Users can create workspaces"
ON public.investigation_workspaces
FOR INSERT
TO authenticated
WITH CHECK (created_by_user_id = auth.uid());