-- Fix the chicken-and-egg problem with workspace creation
-- When a workspace is created, the creator needs to add themselves as owner
-- But the current policies check is_workspace_owner which requires the member record to exist

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Owners can add members" ON public.workspace_members;
DROP POLICY IF EXISTS "Contributors can send messages" ON public.workspace_messages;

-- Create helper function to check if user is the workspace creator
CREATE OR REPLACE FUNCTION public.is_workspace_creator(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.investigation_workspaces
    WHERE id = _workspace_id AND created_by_user_id = _user_id
  )
$$;

-- New policy for workspace_members INSERT:
-- Allow if user is workspace owner OR if user is the workspace creator adding themselves as owner
CREATE POLICY "Users can add members"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- Existing owners can add members
  is_workspace_owner(workspace_id, auth.uid())
  -- OR the workspace creator adding themselves as owner (for initial setup)
  OR (is_workspace_creator(workspace_id, auth.uid()) AND user_id = auth.uid() AND role = 'owner')
);

-- New policy for workspace_messages INSERT:
-- Allow contributors OR workspace creator (for initial system messages)
CREATE POLICY "Members can send messages"
ON public.workspace_messages
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND (
    is_workspace_contributor(workspace_id, auth.uid())
    OR is_workspace_creator(workspace_id, auth.uid())
  )
);