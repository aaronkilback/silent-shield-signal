-- RLS Containment Batch 1 (rows 1-5,7-12; internal_assets/profiles/Batch3 excluded).
-- Applied to prod via MCP apply_migration (version 20260612150805). This file mirrors it
-- for repo/migration-history consistency. Closes broad authenticated/PUBLIC policies that
-- leaked cross-tenant operational rows. service_role + existing role/super_admin policies kept.
-- Plan + rollback: docs/platform-operations/rls-containment-plan-2026-06-12.md
-- Verified: A (Silent Shield Ops owner) monitoring_proposals 611->440, foreign->0; B (CRT admin)
-- 80, foreign rows->0; foreign INSERT blocked, own INSERT allowed; 0 residual broad policies.

-- ROW1 threat_radar_snapshots (SET-C full)
DROP POLICY IF EXISTS "Authenticated users can create threat radar snapshots" ON public.threat_radar_snapshots;
DROP POLICY IF EXISTS "Authenticated users can view threat radar snapshots" ON public.threat_radar_snapshots;
DROP POLICY IF EXISTS "auth_users_can_view_threat_radar" ON public.threat_radar_snapshots;
DROP POLICY IF EXISTS "Authenticated users can update threat radar snapshots" ON public.threat_radar_snapshots;
CREATE POLICY "trs_sel" ON public.threat_radar_snapshots FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "trs_ins" ON public.threat_radar_snapshots FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "trs_upd" ON public.threat_radar_snapshots FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "trs_del" ON public.threat_radar_snapshots FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW2 radical_activity_tracking
DROP POLICY IF EXISTS "Authenticated users can manage radical activity" ON public.radical_activity_tracking;
DROP POLICY IF EXISTS "Authenticated users can view radical activity" ON public.radical_activity_tracking;
CREATE POLICY "rat_sel" ON public.radical_activity_tracking FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "rat_ins" ON public.radical_activity_tracking FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "rat_upd" ON public.radical_activity_tracking FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "rat_del" ON public.radical_activity_tracking FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW3 sentiment_tracking
DROP POLICY IF EXISTS "Authenticated users can manage sentiment tracking" ON public.sentiment_tracking;
DROP POLICY IF EXISTS "Authenticated users can view sentiment tracking" ON public.sentiment_tracking;
CREATE POLICY "snt_sel" ON public.sentiment_tracking FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "snt_ins" ON public.sentiment_tracking FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "snt_upd" ON public.sentiment_tracking FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "snt_del" ON public.sentiment_tracking FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW4 predictive_threat_models
DROP POLICY IF EXISTS "Authenticated users can manage predictive models" ON public.predictive_threat_models;
DROP POLICY IF EXISTS "Authenticated users can view predictive models" ON public.predictive_threat_models;
CREATE POLICY "ptm_sel" ON public.predictive_threat_models FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "ptm_ins" ON public.predictive_threat_models FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "ptm_upd" ON public.predictive_threat_models FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "ptm_del" ON public.predictive_threat_models FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW5 threat_precursor_indicators
DROP POLICY IF EXISTS "Authenticated users can manage precursor indicators" ON public.threat_precursor_indicators;
DROP POLICY IF EXISTS "Authenticated users can view precursor indicators" ON public.threat_precursor_indicators;
CREATE POLICY "tpi_sel" ON public.threat_precursor_indicators FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "tpi_ins" ON public.threat_precursor_indicators FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "tpi_upd" ON public.threat_precursor_indicators FOR UPDATE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "tpi_del" ON public.threat_precursor_indicators FOR DELETE TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW7 investigation_threads (read add; writes stay service_role)
DROP POLICY IF EXISTS "Authenticated read" ON public.investigation_threads;
CREATE POLICY "ithreads_sel" ON public.investigation_threads FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW8 monitoring_proposals (read add; keep service insert + admin update)
DROP POLICY IF EXISTS "Authenticated users can view proposals" ON public.monitoring_proposals;
CREATE POLICY "mprop_sel" ON public.monitoring_proposals FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW9 signal_correlation_groups (drop broad read; scoped CRUD already present)
DROP POLICY IF EXISTS "auth_users_can_view_correlation_groups" ON public.signal_correlation_groups;
-- ROW10 task_force_missions (read add; keep admin manage + create-own)
DROP POLICY IF EXISTS "Authenticated users can view missions" ON public.task_force_missions;
CREATE POLICY "tfm_sel" ON public.task_force_missions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- ROW11 travel_alerts (Pattern-D derived; keep roles/service/super_admin)
DROP POLICY IF EXISTS "auth_users_can_view_travel_alerts" ON public.travel_alerts;
CREATE POLICY "talerts_sel_scoped" ON public.travel_alerts FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid())
  OR traveler_id IN (SELECT id FROM public.travelers WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR itinerary_id IN (SELECT id FROM public.itineraries WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
-- ROW12 travel_itineraries (read add; keep super_admin bypass)
DROP POLICY IF EXISTS "auth_users_can_view_travel_itineraries" ON public.travel_itineraries;
DROP POLICY IF EXISTS "authenticated_read_travel_itineraries" ON public.travel_itineraries;
CREATE POLICY "titin_sel" ON public.travel_itineraries FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
