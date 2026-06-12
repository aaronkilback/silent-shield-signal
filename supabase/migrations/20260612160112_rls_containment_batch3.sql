-- RLS Containment Batch 3 (final 4 of the audited 25). Applied to prod (version 20260612160112).
-- All 0 rows today; broad read closed pre-emptively (future rows would otherwise leak).
-- Classification (schema + usage, no assumptions): no global/default marker + no L2 approval/anonymization
-- mechanism on any => NOT global, NOT L2. All tenant/client operational by schema column.
--   investigation_playbooks (tenant_id) + tech_radar_recommendations (tenant_id) -> SET-T.
--   investigation_templates (client_id) + false_positive_patterns (client_id) -> SET-C.
-- false_positive_patterns also carried an analyst-UNSCOPED manage policy (any analyst read/write all clients)
--   -> replaced with admin/super_admin-global + analyst-client-scoped.
-- Edge consumers (generate-playbook, learn-from-investigations, process-stored-document, tech-radar-scanner,
--   dashboard-ai-assistant, etc.) use service_role (RLS-bypass) -> unaffected. NULL rows fail closed.
-- Verified with synthetic two-tenant + NULL rows: user A sees only own (1 each), foreign->0, NULL->0;
-- no-tenant write blocked; 0 residual broad policies on all 4.
DROP POLICY IF EXISTS "Authenticated users can view playbooks" ON public.investigation_playbooks;
CREATE POLICY "ipb_sel" ON public.investigation_playbooks FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR tenant_id IN (SELECT c.tenant_id FROM public.clients c WHERE c.id IN (SELECT client_id FROM get_user_accessible_client_ids())));

DROP POLICY IF EXISTS "Authenticated users can read investigation templates" ON public.investigation_templates;
CREATE POLICY "itpl_sel" ON public.investigation_templates FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "Authenticated users can view patterns" ON public.false_positive_patterns;
DROP POLICY IF EXISTS "Admins and analysts can manage patterns" ON public.false_positive_patterns;
CREATE POLICY "fpp_sel" ON public.false_positive_patterns FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "fpp_manage" ON public.false_positive_patterns FOR ALL TO authenticated USING (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
) WITH CHECK (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

DROP POLICY IF EXISTS "Authenticated users can read tech radar" ON public.tech_radar_recommendations;
CREATE POLICY "trr_sel" ON public.tech_radar_recommendations FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR tenant_id IN (SELECT c.tenant_id FROM public.clients c WHERE c.id IN (SELECT client_id FROM get_user_accessible_client_ids())));
