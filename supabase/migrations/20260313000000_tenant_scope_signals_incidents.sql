-- Tenant-scoped RLS for signals and incidents
-- Replaces the broad auth.uid() IS NOT NULL policies with client/tenant-scoped access
-- Super admin bypass preserved via is_super_admin() SECURITY DEFINER function
-- Single-operator deployments still work: users see data for their tenant's clients

-- Helper function: returns client IDs accessible to the calling user
-- SECURITY DEFINER to avoid RLS recursion on tenant_users / clients
CREATE OR REPLACE FUNCTION public.get_user_accessible_client_ids()
RETURNS TABLE(client_id UUID) LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT c.id
  FROM public.clients c
  INNER JOIN public.tenant_users tu ON tu.tenant_id = c.tenant_id
  WHERE tu.user_id = auth.uid()
$$;

-- ==================== SIGNALS ====================
DROP POLICY IF EXISTS "auth_users_can_view_signals" ON public.signals;
CREATE POLICY "tenant_scoped_signals_select"
ON public.signals FOR SELECT
TO authenticated
USING (
  is_super_admin(auth.uid())
  OR client_id IS NULL  -- system-level signals with no client scope
  OR client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
);

-- ==================== INCIDENTS ====================
DROP POLICY IF EXISTS "auth_users_can_view_incidents" ON public.incidents;
CREATE POLICY "tenant_scoped_incidents_select"
ON public.incidents FOR SELECT
TO authenticated
USING (
  is_super_admin(auth.uid())
  OR client_id IS NULL
  OR client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
);
