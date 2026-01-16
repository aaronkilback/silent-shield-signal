-- Remove the conflicting INSERT policy that requires specific roles
DROP POLICY IF EXISTS "Authorized users can create workspaces" ON public.investigation_workspaces;

-- Keep the simpler policy that just requires authenticated user = creator
-- This policy already exists: "Users can create workspaces"