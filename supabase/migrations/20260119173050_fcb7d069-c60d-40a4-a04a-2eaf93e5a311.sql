-- Drop existing conflicting SELECT policies
DROP POLICY IF EXISTS "Admins and analysts can view entities" ON public.entities;
DROP POLICY IF EXISTS "Users can view entities for their client" ON public.entities;

-- Create a unified SELECT policy that properly handles null client_id
CREATE POLICY "Users can view entities"
ON public.entities
FOR SELECT
TO authenticated
USING (
  -- Super admins can see all entities
  is_super_admin(auth.uid())
  OR (
    -- Other roles (admin, analyst, viewer) can see entities
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'viewer'::app_role))
    AND (
      -- Entity has no client_id (global entity)
      client_id IS NULL
      -- Or entity belongs to current client
      OR client_id::text = current_setting('app.current_client_id', true)
      -- Or no client filter is set
      OR current_setting('app.current_client_id', true) IS NULL
      OR current_setting('app.current_client_id', true) = ''
    )
  )
);