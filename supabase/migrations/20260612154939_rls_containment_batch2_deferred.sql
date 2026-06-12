-- RLS Containment Batch 2 — resolve 2 deferred tables (applied to prod, version 20260612154939).
-- auto_escalation_rules (3 system global-default rules, NULL tenant, service_role-consumed) and
-- scheduled_briefings (1 operational config with UNASSIGNED ownership, NULL client/tenant, service_role-consumed)
-- both still carried broad authenticated read. Decision: FAIL CLOSED for normal/no-tenant users.
-- SELECT scoped by tenant/client ownership; current NULL rows -> admin/super_admin + service_role only.
-- Existing "Admins can manage" + service_role policies preserved (admins + engines unaffected).
-- Verified (synthetic two-tenant rows + real identities): A sees only own-tenant/client row, foreign->0,
-- NULL->0; no-tenant traveller 0/0; normal-user write blocked; super_admin sees all (3 aer + 1 sb); 0 residual broad.
-- NULL rows remain ownership debt (tasks #32 global-promote-or-stamp / #33 stamp owner).
DROP POLICY IF EXISTS "Authenticated users can view escalation rules" ON public.auto_escalation_rules;
CREATE POLICY "aer_sel" ON public.auto_escalation_rules FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid())
  OR tenant_id IN (SELECT c.tenant_id FROM public.clients c WHERE c.id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated users can view scheduled briefings" ON public.scheduled_briefings;
CREATE POLICY "sb_sel" ON public.scheduled_briefings FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid())
  OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
  OR tenant_id IN (SELECT c.tenant_id FROM public.clients c WHERE c.id IN (SELECT client_id FROM get_user_accessible_client_ids())));
