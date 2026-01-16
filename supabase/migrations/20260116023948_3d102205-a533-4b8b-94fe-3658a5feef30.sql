-- Allow workspace members to view profiles of other members in the same workspace
-- This is essential for collaboration features like task assignment and chat
CREATE POLICY "Workspace members can view fellow workspace member profiles"
ON public.profiles
FOR SELECT
USING (
  id IN (
    SELECT wm2.user_id 
    FROM workspace_members wm1
    JOIN workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = auth.uid()
  )
);