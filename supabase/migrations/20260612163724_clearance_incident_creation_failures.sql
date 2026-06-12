-- Clearance residual (found by the final DB-wide no-tenant proof, applied 20260612163724).
-- incident_creation_failures had a PUBLIC-true ALL policy mislabeled "service_role_full_access"
-- (any authenticated could read+write 62 rows of failed-incident payloads: client_id + signal_id +
-- attempted_data). Has client_id -> SET-C scope; writes service_role only; NULL-client rows super_admin only.
-- Verified: A (tenant owner) 62->40, no-tenant 0, write blocked, super_admin 62.
DROP POLICY IF EXISTS "service_role_full_access" ON public.incident_creation_failures;
CREATE POLICY "icf_service" ON public.incident_creation_failures FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "icf_sel" ON public.incident_creation_failures FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
