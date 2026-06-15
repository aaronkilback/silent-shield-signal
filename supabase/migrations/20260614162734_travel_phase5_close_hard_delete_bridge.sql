-- Reconciliation of MCP-applied migration (prod history version 20260614162734).
-- Travel Editing slice — Phase 5: close the D1 hard-delete bridge. Operators (analyst/admin)
-- lose DIRECT hard-delete on travelers/itineraries; they retain INSERT (create) + UPDATE
-- (edit + archive-via-status). Physical DELETE is now restricted to super_admin (emergency,
-- via super_admin_bypass_*). Normal operational "delete" is archive (status='archived')
-- through travel-record-mutate. SELECT policies unchanged.
DROP POLICY IF EXISTS travelers_manage_tenant_scoped ON public.travelers;
CREATE POLICY travelers_insert_operator ON public.travelers FOR INSERT TO authenticated
 WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY travelers_update_operator ON public.travelers FOR UPDATE TO authenticated
 USING (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))
 WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS itineraries_manage_tenant_scoped ON public.itineraries;
CREATE POLICY itineraries_insert_operator ON public.itineraries FOR INSERT TO authenticated
 WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY itineraries_update_operator ON public.itineraries FOR UPDATE TO authenticated
 USING (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))
 WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
