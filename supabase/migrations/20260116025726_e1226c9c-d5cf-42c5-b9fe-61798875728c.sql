-- Drop all existing SELECT policies on profiles and create one clean policy
DROP POLICY IF EXISTS "Users can view own or admin can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view profiles in their client" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles of workspace colleagues" ON public.profiles;

-- Create a single comprehensive SELECT policy
CREATE POLICY "Profile viewing policy"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  -- Users can always view their own profile
  id = auth.uid()
  OR
  -- Super admins and admins can view all profiles
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('super_admin', 'admin', 'analyst')
  )
  OR
  -- Workspace members can view colleagues
  EXISTS (
    SELECT 1 FROM workspace_members wm1
    JOIN workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = auth.uid() AND wm2.user_id = profiles.id
  )
);