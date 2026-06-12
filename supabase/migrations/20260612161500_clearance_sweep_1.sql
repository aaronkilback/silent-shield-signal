-- No-Tenant Clearance Sweep-1 — close live read leaks + authenticated-write control-plane risks
-- on tables OUTSIDE the client_id/tenant_id audit set. Applied to prod via MCP.
-- Method: derive scope via FK to client-scoped parents; fail closed where unowned; explicit labelled-global
-- only for confirmed non-sensitive reference; control-plane -> service_role + admin-read; no broad authenticated.
-- service_role behavior preserved (explicit TO service_role policies replace mislabeled PUBLIC-true ones).

-- ===== LIVE DATA TABLES (derive-scoped) =====
-- report_evidence_sources (4847 rows) -> via reports.client_id
DROP POLICY IF EXISTS "Authenticated users can view evidence sources" ON public.report_evidence_sources;
DROP POLICY IF EXISTS "Authenticated users and system can insert evidence sources" ON public.report_evidence_sources;
CREATE POLICY "res_sel" ON public.report_evidence_sources FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR report_id IN (SELECT id FROM public.reports WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY "res_ins" ON public.report_evidence_sources FOR INSERT TO authenticated WITH CHECK (
  is_super_admin(auth.uid()) OR report_id IN (SELECT id FROM public.reports WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- media_assets (141) -> uploaded_by self OR via client-scoped parents
DROP POLICY IF EXISTS "media_assets_read_all_auth" ON public.media_assets;
DROP POLICY IF EXISTS "media_assets_write_auth" ON public.media_assets;
CREATE POLICY "media_assets_sel" ON public.media_assets FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR uploaded_by = auth.uid()
  OR asset_id IN (SELECT id FROM public.client_assets WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR audit_id IN (SELECT id FROM public.site_audits WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR observation_id IN (SELECT o.id FROM public.site_observations o JOIN public.site_audits sa ON sa.id=o.audit_id WHERE sa.client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY "media_assets_write" ON public.media_assets FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR uploaded_by = auth.uid())
  WITH CHECK (is_super_admin(auth.uid()) OR uploaded_by = auth.uid());

-- monitoring_history (64925) -> drop the broad read; keep role-gated staff views (system telemetry, no client col)
DROP POLICY IF EXISTS "auth_users_can_view_monitoring_history" ON public.monitoring_history;

-- threat_trajectories (8) -> via child trajectory_positions.client_id
DROP POLICY IF EXISTS "Authenticated read" ON public.threat_trajectories;
CREATE POLICY "tt_sel" ON public.threat_trajectories FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR id IN (SELECT trajectory_id FROM public.trajectory_positions WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- asset_vulnerabilities (5) -> via internal_assets.client_id (NULL-client parents => super_admin only)
DROP POLICY IF EXISTS "Authenticated users can view asset vulnerabilities" ON public.asset_vulnerabilities;
CREATE POLICY "av_sel" ON public.asset_vulnerabilities FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR asset_id IN (SELECT id FROM public.internal_assets WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- ===== GLOBAL REFERENCE (non-sensitive) -> explicit labelled-global read =====
DROP POLICY IF EXISTS "Authenticated users can read environment config" ON public.environment_config;
CREATE POLICY "environment_config_global_read" ON public.environment_config FOR SELECT TO authenticated USING (true); -- non-sensitive production flags
DROP POLICY IF EXISTS "Authenticated users can view expert profiles" ON public.expert_profiles;
CREATE POLICY "expert_profiles_global_read" ON public.expert_profiles FOR SELECT TO authenticated USING (true); -- public external-expert directory

-- ===== CONTROL-PLANE -> service_role (explicit) + admin read; no authenticated write =====
DROP POLICY IF EXISTS "Service role full access cron_job_registry" ON public.cron_job_registry;
CREATE POLICY "cjr_service" ON public.cron_job_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "cjr_admin_read" ON public.cron_job_registry FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role can manage cron heartbeat" ON public.cron_heartbeat;
CREATE POLICY "ch_service" ON public.cron_heartbeat FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ch_admin_read" ON public.cron_heartbeat FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Service can manage circuit breaker state" ON public.circuit_breaker_state;
CREATE POLICY "cbs_service" ON public.circuit_breaker_state FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service can manage dead letter queue" ON public.dead_letter_queue;
CREATE POLICY "dlq_service" ON public.dead_letter_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.codebase_snapshot;
CREATE POLICY "cs_service" ON public.codebase_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "cs_admin_read" ON public.codebase_snapshot FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "authenticated_read_codebase_snapshots" ON public.codebase_snapshots;
CREATE POLICY "css_admin_read" ON public.codebase_snapshots FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role full access frontend_errors" ON public.frontend_errors;
CREATE POLICY "fe_service" ON public.frontend_errors FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "fe_admin_read" ON public.frontend_errors FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));
-- (keep "Authenticated users can insert frontend errors": own error reporting)

DROP POLICY IF EXISTS "System can manage rate limits" ON public.rate_limit_tracking;
CREATE POLICY "rlt_service" ON public.rate_limit_tracking FOR ALL TO service_role USING (true) WITH CHECK (true);
-- (keep "Users can view their own rate limits")

-- ===== OPERATIONAL broad-write -> derive-scoped read + service write (explicit) =====
DROP POLICY IF EXISTS "service_role_full_access" ON public.incident_outcomes;
DROP POLICY IF EXISTS "Analysts and admins can manage outcomes" ON public.incident_outcomes;
DROP POLICY IF EXISTS "Analysts and admins can view outcomes" ON public.incident_outcomes;
CREATE POLICY "io_service" ON public.incident_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "io_sel" ON public.incident_outcomes FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
CREATE POLICY "io_manage" ON public.incident_outcomes FOR ALL TO authenticated USING (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())))
) WITH CHECK (
  is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)
  OR (has_role(auth.uid(),'analyst'::app_role) AND incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))));

DROP POLICY IF EXISTS "Service role manages all" ON public.signal_anomaly_scores;
CREATE POLICY "sas_service" ON public.signal_anomaly_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sas_sel" ON public.signal_anomaly_scores FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

DROP POLICY IF EXISTS "Service role manages speculative" ON public.speculative_analyses;
DROP POLICY IF EXISTS "Authenticated read speculative" ON public.speculative_analyses;
CREATE POLICY "spa_service" ON public.speculative_analyses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "spa_sel" ON public.speculative_analyses FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid())
  OR signal_id IN (SELECT id FROM public.signals WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  OR incident_id IN (SELECT id FROM public.incidents WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

DROP POLICY IF EXISTS "Service role manages all" ON public.debate_predictions;
CREATE POLICY "dp_service" ON public.debate_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "dp_sel" ON public.debate_predictions FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR debate_record_id IN (SELECT id FROM public.agent_debate_records WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

DROP POLICY IF EXISTS "audit_stage_analyses_write_auth" ON public.audit_stage_analyses;
DROP POLICY IF EXISTS "audit_stage_analyses_read_auth" ON public.audit_stage_analyses;
CREATE POLICY "asa_sel" ON public.audit_stage_analyses FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR audit_id IN (SELECT id FROM public.site_audits WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
-- (keep audit_stage_analyses_write_service)

-- ===== UNOWNED / SENSITIVE / PENDING-CLASSIFICATION -> fail closed (admin/super_admin + service) =====
DROP POLICY IF EXISTS "Authenticated users can manage client_authorizations" ON public.client_authorizations;
CREATE POLICY "ca_admin" ON public.client_authorizations FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
-- (keep "Service role full access on client_authorizations")

DROP POLICY IF EXISTS "Authenticated users can manage petronas assets" ON public.petronas_assets;
DROP POLICY IF EXISTS "Authenticated users can view petronas assets" ON public.petronas_assets;
CREATE POLICY "pa_service" ON public.petronas_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "pa_sa" ON public.petronas_assets FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage knowledge_connections" ON public.knowledge_connections;
DROP POLICY IF EXISTS "Authed manage knowledge_connections" ON public.knowledge_connections;
CREATE POLICY "kc_service" ON public.knowledge_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "kc_admin" ON public.knowledge_connections FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated manage learnings" ON public.learnings;
CREATE POLICY "lrn_service" ON public.learnings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "lrn_admin" ON public.learnings FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated manage listener_feedback" ON public.listener_feedback;
CREATE POLICY "lf_service" ON public.listener_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "lf_admin" ON public.listener_feedback FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated manage episode_arcs" ON public.episode_arcs;
CREATE POLICY "ea_service" ON public.episode_arcs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ea_admin" ON public.episode_arcs FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated manage episode_arc_appearances" ON public.episode_arc_appearances;
CREATE POLICY "eaa_service" ON public.episode_arc_appearances FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "eaa_admin" ON public.episode_arc_appearances FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
