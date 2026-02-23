
-- ============================================================
-- FIX: PUBLIC_DATA_EXPOSURE - Tighten RLS on 4 intelligence tables
-- ============================================================

-- 1. incident_knowledge_graph
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated read" ON public.incident_knowledge_graph;
DROP POLICY IF EXISTS "Service role full access" ON public.incident_knowledge_graph;

-- Add role-restricted SELECT (analyst/admin/super_admin only)
CREATE POLICY "Authorized roles can read knowledge graph"
  ON public.incident_knowledge_graph
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Admin/super_admin can manage
CREATE POLICY "Admins can manage knowledge graph"
  ON public.incident_knowledge_graph
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 2. predictive_incident_scores
DROP POLICY IF EXISTS "Authenticated read" ON public.predictive_incident_scores;
DROP POLICY IF EXISTS "Service role full access" ON public.predictive_incident_scores;

CREATE POLICY "Authorized roles can read predictive scores"
  ON public.predictive_incident_scores
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Admins can manage predictive scores"
  ON public.predictive_incident_scores
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 3. vision_analysis_results
DROP POLICY IF EXISTS "Authenticated read" ON public.vision_analysis_results;
DROP POLICY IF EXISTS "Service role full access" ON public.vision_analysis_results;

CREATE POLICY "Authorized roles can read vision analysis"
  ON public.vision_analysis_results
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Admins can manage vision analysis"
  ON public.vision_analysis_results
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 4. autonomous_scan_results
DROP POLICY IF EXISTS "Service role full access" ON public.autonomous_scan_results;
-- Keep existing "Admins can view scan results" SELECT policy (already correct)

-- Add admin-only write policy
CREATE POLICY "Admins can manage scan results"
  ON public.autonomous_scan_results
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );
