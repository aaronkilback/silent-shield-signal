-- No-Tenant Clearance Sweep-2 — remaining OPERATIONAL tables outside the audit set (read-only broad).
-- Derive-scope via FK to client-scoped parents (signals/incidents/reports/itineraries/task_force_missions/investigations);
-- staff-read (analyst/admin/super_admin) for global platform-ops with NO tenant dimension (agent metrics);
-- admin-read for ops/diagnostic logs; fail-closed admin where derivation is 0-row/unclear.
-- Nothing classified global/L2 (Sweep-3). service_role preserved (bypass + kept explicit policies).
-- Helper: signals/incidents/reports accessible via client_id IN get_user_accessible_client_ids().

-- ===== derive-scope via signals =====
DROP POLICY IF EXISTS "authenticated_read_wraith_threat" ON public.wraith_signal_threat_scores;
CREATE POLICY "wsts_sel" ON public.wraith_signal_threat_scores FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "authenticated_read_wraith_vuln" ON public.wraith_vulnerability_findings;
CREATE POLICY "wvf_sel" ON public.wraith_vulnerability_findings FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated can view score explanations" ON public.signal_score_explanations;
CREATE POLICY "sse_sel" ON public.signal_score_explanations FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated users can view contradictions" ON public.signal_contradictions;
CREATE POLICY "sc_sel" ON public.signal_contradictions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR signal_a_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR signal_b_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- signal_clusters: signal_ids array (no FK), 0 rows -> keep admin/sa manage (covers read); drop broad
DROP POLICY IF EXISTS "Authenticated can view clusters" ON public.signal_clusters;

-- ===== derive-scope via incidents =====
DROP POLICY IF EXISTS "Authenticated users can view classification rationale" ON public.incident_classification_rationale;
DROP POLICY IF EXISTS "Analysts can manage classification rationale" ON public.incident_classification_rationale;
CREATE POLICY "icr_sel" ON public.incident_classification_rationale FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY "icr_manage" ON public.incident_classification_rationale FOR ALL TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR (has_role(auth.uid(),'analyst'::app_role) AND incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))) WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR (has_role(auth.uid(),'analyst'::app_role) AND incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))));

-- ===== report_action_items: derive via report/incident/signal OR owner =====
DROP POLICY IF EXISTS "Authenticated users can view action items" ON public.report_action_items;
DROP POLICY IF EXISTS "Analysts can manage action items" ON public.report_action_items;
CREATE POLICY "rai_sel" ON public.report_action_items FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR owner_id = auth.uid()
  OR report_id IN (SELECT id FROM public.reports WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR related_incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR related_signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY "rai_manage" ON public.report_action_items FOR ALL TO authenticated USING (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND (report_id IN (SELECT id FROM public.reports WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR related_incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR related_signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))))
) WITH CHECK (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND (report_id IN (SELECT id FROM public.reports WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR related_incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())) OR related_signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))));

-- ===== itinerary_scan_history via itineraries =====
DROP POLICY IF EXISTS "Authenticated users can read scan history" ON public.itinerary_scan_history;
CREATE POLICY "ish_sel" ON public.itinerary_scan_history FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR itinerary_id IN (SELECT id FROM public.itineraries WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- ===== task_force_* via task_force_missions =====
DROP POLICY IF EXISTS "Users can view task force agents" ON public.task_force_agents;
CREATE POLICY "tfa_sel" ON public.task_force_agents FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR mission_id IN (SELECT id FROM public.task_force_missions WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Users can view contributions" ON public.task_force_contributions;
CREATE POLICY "tfc_sel" ON public.task_force_contributions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR mission_id IN (SELECT id FROM public.task_force_missions WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- ===== investigation_* via investigations.client_id =====
DROP POLICY IF EXISTS "Authenticated users can view autopilot sessions" ON public.investigation_autopilot_sessions;
CREATE POLICY "ias_sel" ON public.investigation_autopilot_sessions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR investigation_id IN (SELECT id FROM public.investigations WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated users can view autopilot tasks" ON public.investigation_autopilot_tasks;
CREATE POLICY "iat_sel" ON public.investigation_autopilot_tasks FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR investigation_id IN (SELECT id FROM public.investigations WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated users can read similarity cache" ON public.investigation_similarity_cache;
CREATE POLICY "isc_sel" ON public.investigation_similarity_cache FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR investigation_id IN (SELECT id FROM public.investigations WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS "Authenticated users can view compliance records" ON public.investigation_compliance;
CREATE POLICY "ic_sel" ON public.investigation_compliance FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR user_id = auth.uid());

-- ===== global platform-ops (no tenant dimension): staff-read =====
DROP POLICY IF EXISTS "Authenticated users can view agent metrics" ON public.agent_accuracy_metrics;
CREATE POLICY "aam_sel" ON public.agent_accuracy_metrics FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view agent assessments" ON public.agent_assessments;
CREATE POLICY "aa_sel" ON public.agent_assessments FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "agent_calibration_scores_read" ON public.agent_calibration_scores;
CREATE POLICY "acs_sel" ON public.agent_calibration_scores FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "Agent learning sessions viewable" ON public.agent_learning_sessions;
CREATE POLICY "als_sel" ON public.agent_learning_sessions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "agent_specialty_embeddings_read" ON public.agent_specialty_embeddings;
CREATE POLICY "ase_sel" ON public.agent_specialty_embeddings FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));

-- ===== ops/diagnostic logs: admin-read =====
DROP POLICY IF EXISTS "Authenticated users can view actions log" ON public.autonomous_actions_log;
CREATE POLICY "aal_sel" ON public.autonomous_actions_log FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "authenticated_read_qa_test_results" ON public.qa_test_results;
CREATE POLICY "qa_sel" ON public.qa_test_results FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view freshness audits" ON public.knowledge_freshness_audits;
CREATE POLICY "kfa_sel" ON public.knowledge_freshness_audits FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view geospatial maps" ON public.geospatial_maps;
CREATE POLICY "gm_sel" ON public.geospatial_maps FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR uploaded_by = auth.uid());

-- ===== fail-closed admin (0-row, briefing-derived, unclear) =====
DROP POLICY IF EXISTS "Users can view briefing claims" ON public.briefing_claims;
CREATE POLICY "bc_sel" ON public.briefing_claims FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Users can view claim sources" ON public.claim_sources;
CREATE POLICY "cs_sel" ON public.claim_sources FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
