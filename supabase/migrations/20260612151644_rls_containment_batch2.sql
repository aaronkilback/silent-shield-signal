-- RLS Containment Batch 2 (6 of 9 tables). Applied to prod via MCP (version 20260612151644).
-- DEFERRED (NULL-ownership / ambiguous — see ownership-debt tasks, broad read left in place pending classification):
--   auto_escalation_rules (3 NULL-tenant rows), scheduled_briefings (1 NULL/NULL row).
-- profiles handled separately (sensitive: last_known geo; requires pre-checks).
-- internal_assets untouched. service_role + role/super_admin policies preserved.
-- Verified (real two-tenant RLS): A (Silent Shield Ops owner, not super_admin) client_observation_baselines
-- 690->491 & foreign->0; signal_sequences 17->15 & foreign->0; B (CRT admin) cob 187 & A-owned->0;
-- agent_missions foreign INSERT blocked, own INSERT allowed; 0 residual broad policies on the 6 tables.

DROP POLICY IF EXISTS "authenticated_read_watch_list" ON public.entity_watch_list;
CREATE POLICY "ewl_sel" ON public.entity_watch_list FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "ss-auth-read" ON public.signal_sequences;
CREATE POLICY "ss_sel" ON public.signal_sequences FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "Authenticated users can create agent_missions" ON public.agent_missions;
DROP POLICY IF EXISTS "Authenticated users can read agent_missions" ON public.agent_missions;
DROP POLICY IF EXISTS "Authenticated users can update agent_missions" ON public.agent_missions;
CREATE POLICY "am_sel" ON public.agent_missions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "am_ins" ON public.agent_missions FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "am_upd" ON public.agent_missions FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "am_del" ON public.agent_missions FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "Authenticated read" ON public.agent_world_predictions;
CREATE POLICY "awp_sel" ON public.agent_world_predictions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "Authenticated read" ON public.trajectory_positions;
CREATE POLICY "tp_sel" ON public.trajectory_positions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

DROP POLICY IF EXISTS "cob-auth-read" ON public.client_observation_baselines;
CREATE POLICY "cob_sel" ON public.client_observation_baselines FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
