-- No-Tenant Clearance Sweep-3 (final) — reference/learning/knowledge tables.
-- Classified per operator's 5-category framework; NOTHING classified global/L2 merely for lacking tenant_id.
-- CAT 1 true global reference (no-tenant intentionally allowed): explicit labelled-global read.
-- CAT 3 staff/internal (no-tenant 0): staff (analyst/admin/super_admin) or admin read.
-- CAT 5 unresolved -> fail closed admin/super_admin + service (expert_knowledge/global_chunks/global_docs:
--   no L2/anonymization/approval mechanism in schema; expert_knowledge has documented tenant-contamination
--   history -> NOT proven safe -> admin-only; follow-up classification tasks created).
-- service_role preserved (bypass + kept explicit policies).

-- ===== CAT 1: true global reference (no-tenant allowed) =====
DROP POLICY IF EXISTS "world_geographies_read_all_auth" ON public.world_geographies;
CREATE POLICY "world_geographies_global_read" ON public.world_geographies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "world_geography_layers_read_all_auth" ON public.world_geography_layers;
CREATE POLICY "world_geography_layers_global_read" ON public.world_geography_layers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read knowledge sources" ON public.world_knowledge_sources;
CREATE POLICY "world_knowledge_sources_global_read" ON public.world_knowledge_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read macro_indicators" ON public.macro_indicators;
CREATE POLICY "macro_indicators_global_read" ON public.macro_indicators FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read wildfire station ratings" ON public.wildfire_station_ratings;
CREATE POLICY "wildfire_station_ratings_global_read" ON public.wildfire_station_ratings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "req_ver_read_all_auth" ON public.onboarding_required_versions;
CREATE POLICY "onboarding_required_versions_global_read" ON public.onboarding_required_versions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users view published courses" ON public.academy_courses;
CREATE POLICY "academy_courses_global_read" ON public.academy_courses FOR SELECT TO authenticated USING (published = true);
DROP POLICY IF EXISTS "View modules of published courses" ON public.academy_modules;
CREATE POLICY "academy_modules_global_read" ON public.academy_modules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_courses c WHERE c.id = academy_modules.course_id AND c.published = true));
DROP POLICY IF EXISTS "Credentials are publicly viewable by ID" ON public.academy_credentials;
CREATE POLICY "academy_credentials_global_read" ON public.academy_credentials FOR SELECT TO authenticated USING (true);

-- ===== CAT 3: staff/internal (no-tenant 0) =====
-- KB + ai_agents: keep existing staff policies; just drop the broad authenticated read
DROP POLICY IF EXISTS "Authenticated users can view knowledge base articles" ON public.knowledge_base_articles;
DROP POLICY IF EXISTS "Authenticated users can view knowledge base categories" ON public.knowledge_base_categories;
DROP POLICY IF EXISTS "Authenticated users can view AI agents" ON public.ai_agents;
-- doctrine/sim/sequence/source-credibility: staff read (analyst/admin/sa)
DROP POLICY IF EXISTS "Authenticated users can read doctrine" ON public.doctrine_library;
CREATE POLICY "doctrine_staff_read" ON public.doctrine_library FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view simulations" ON public.simulation_scenarios;
CREATE POLICY "simulation_scenarios_staff_read" ON public.simulation_scenarios FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "sp-auth-read" ON public.sequence_patterns;
CREATE POLICY "sequence_patterns_staff_read" ON public.sequence_patterns FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "Authenticated read" ON public.source_credibility_scores;
CREATE POLICY "source_credibility_staff_read" ON public.source_credibility_scores FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view RoE" ON public.rules_of_engagement;
CREATE POLICY "roe_staff_read" ON public.rules_of_engagement FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'analyst'::app_role));
-- admin-only internal config/telemetry
DROP POLICY IF EXISTS "Authenticated read prompt_versions" ON public.prompt_versions;
CREATE POLICY "prompt_versions_admin_read" ON public.prompt_versions FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Anyone can view tone rules" ON public.executive_tone_rules;
DROP POLICY IF EXISTS "wildfire_portal_usage_authenticated_read" ON public.wildfire_portal_usage;
CREATE POLICY "wildfire_portal_usage_admin_read" ON public.wildfire_portal_usage FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated read episode_embeddings" ON public.episode_embeddings;
CREATE POLICY "episode_embeddings_admin_read" ON public.episode_embeddings FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated read episode_judgments" ON public.episode_judgments;
CREATE POLICY "episode_judgments_admin_read" ON public.episode_judgments FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

-- ===== CAT 5: unresolved -> fail closed admin/super_admin + service (L2 classification pending) =====
DROP POLICY IF EXISTS "Authenticated users can read expert knowledge" ON public.expert_knowledge;
CREATE POLICY "expert_knowledge_admin_read" ON public.expert_knowledge FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated users can read global chunks" ON public.global_chunks;
CREATE POLICY "global_chunks_admin_read" ON public.global_chunks FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated users can read global docs" ON public.global_docs;
CREATE POLICY "global_docs_admin_read" ON public.global_docs FOR SELECT TO authenticated USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
