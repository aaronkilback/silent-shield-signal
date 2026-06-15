-- Reconciliation of MCP-applied migration (prod history version 20260613213607).
-- Travel Editing slice — Phase 1 RLS mutation hardening.
-- Closes R1 (role-ungated public mutate policies let any client-accessible user, incl.
-- viewer/traveller, mutate operational travel records) and R2 (travel_alerts manage policy
-- was role-only, not client-scoped => cross-tenant alert mutation). Also drops the role-only
-- travel_alerts SELECT (cross-tenant read leak). itinerary_scan_history stays append-only.
-- service_role + super_admin paths preserved.

-- itineraries: drop role-ungated public mutate (manage ALL + super_admin remain)
DROP POLICY IF EXISTS itineraries_tenant_insert ON public.itineraries;
DROP POLICY IF EXISTS itineraries_tenant_update ON public.itineraries;
DROP POLICY IF EXISTS itineraries_tenant_delete ON public.itineraries;

-- travelers: same
DROP POLICY IF EXISTS travelers_tenant_insert ON public.travelers;
DROP POLICY IF EXISTS travelers_tenant_update ON public.travelers;
DROP POLICY IF EXISTS travelers_tenant_delete ON public.travelers;

-- itinerary_travelers: drop public mutate; add role-gated client-scoped manage (had none)
DROP POLICY IF EXISTS itinerary_travelers_tenant_insert ON public.itinerary_travelers;
DROP POLICY IF EXISTS itinerary_travelers_tenant_update ON public.itinerary_travelers;
DROP POLICY IF EXISTS itinerary_travelers_tenant_delete ON public.itinerary_travelers;
CREATE POLICY itinerary_travelers_manage_scoped ON public.itinerary_travelers
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))
  WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- travel_alerts: replace role-only manage with client-scoped UPDATE (ack workflow); drop role-only SELECT
DROP POLICY IF EXISTS "Authorized roles can manage travel alerts" ON public.travel_alerts;
CREATE POLICY travel_alerts_update_scoped ON public.travel_alerts
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND (traveler_id IN (SELECT id FROM public.travelers WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR itinerary_id IN (SELECT id FROM public.itineraries WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))))
  WITH CHECK (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND (traveler_id IN (SELECT id FROM public.travelers WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR itinerary_id IN (SELECT id FROM public.itineraries WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))));
DROP POLICY IF EXISTS "Authorized roles can view travel alerts" ON public.travel_alerts;
