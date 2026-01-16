-- Drop the complex workspace members policy and replace with a simpler one
DROP POLICY IF EXISTS "Workspace members can view fellow workspace member profiles" ON public.profiles;

-- Create a simpler policy: authenticated users can view profiles of users in shared workspaces
CREATE POLICY "Users can view profiles of workspace colleagues"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid() -- Can always view own profile
  OR
  id IN (
    SELECT DISTINCT wm.user_id 
    FROM workspace_members wm 
    WHERE wm.workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  )
);