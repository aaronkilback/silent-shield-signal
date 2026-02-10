
-- =====================================================
-- FIX 1: agent_investigation_memory - restrict service role policy
-- =====================================================
DROP POLICY IF EXISTS "Service role full access" ON public.agent_investigation_memory;
DROP POLICY IF EXISTS "Authenticated read" ON public.agent_investigation_memory;

-- Only authenticated analysts/admins/super_admins can read
CREATE POLICY "Authorized roles can read investigation memory"
ON public.agent_investigation_memory FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Only admins/super_admins can insert/update/delete
CREATE POLICY "Admins can manage investigation memory"
ON public.agent_investigation_memory FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- =====================================================
-- FIX 2: agent_debate_records - restrict service role policy
-- =====================================================
DROP POLICY IF EXISTS "Service role full access" ON public.agent_debate_records;
DROP POLICY IF EXISTS "Authenticated read" ON public.agent_debate_records;

CREATE POLICY "Authorized roles can read debate records"
ON public.agent_debate_records FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can manage debate records"
ON public.agent_debate_records FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- =====================================================
-- FIX 3: rejected_content_hashes - restrict service role policy
-- =====================================================
DROP POLICY IF EXISTS "Service role full access" ON public.rejected_content_hashes;

CREATE POLICY "Authorized roles can read rejected hashes"
ON public.rejected_content_hashes FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can manage rejected hashes"
ON public.rejected_content_hashes FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- =====================================================
-- FIX 4: watchdog_learnings - restrict service role policy
-- =====================================================
DROP POLICY IF EXISTS "Service role full access on watchdog_learnings" ON public.watchdog_learnings;

CREATE POLICY "Super admins can read watchdog learnings"
ON public.watchdog_learnings FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Super admins can manage watchdog learnings"
ON public.watchdog_learnings FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role)
);

-- =====================================================
-- FIX 5: analyst_accuracy_metrics - restrict open SELECT
-- =====================================================
DROP POLICY IF EXISTS "Analysts can view all accuracy metrics" ON public.analyst_accuracy_metrics;

CREATE POLICY "Users can view own or admins can view all accuracy metrics"
ON public.analyst_accuracy_metrics FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- =====================================================
-- FIX 6: source_artifacts - restrict to authenticated role
-- =====================================================
DROP POLICY IF EXISTS "Users can view source artifacts in their tenant" ON public.source_artifacts;
DROP POLICY IF EXISTS "Users can create source artifacts" ON public.source_artifacts;

CREATE POLICY "Authenticated users can view source artifacts in their tenant"
ON public.source_artifacts FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR tenant_id IS NULL
  OR tenant_id IN (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.user_id = auth.uid())
);

CREATE POLICY "Authenticated users can create source artifacts"
ON public.source_artifacts FOR INSERT TO authenticated
WITH CHECK (
  is_super_admin(auth.uid())
  OR tenant_id IS NULL
  OR tenant_id IN (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.user_id = auth.uid())
);

-- =====================================================
-- FIX 7: watchdog_effectiveness view - change to SECURITY INVOKER
-- =====================================================
DROP VIEW IF EXISTS public.watchdog_effectiveness;

CREATE VIEW public.watchdog_effectiveness
WITH (security_invoker = true)
AS
SELECT 
  finding_category,
  remediation_action,
  count(*) AS total_attempts,
  count(*) FILTER (WHERE remediation_success = true) AS successes,
  count(*) FILTER (WHERE remediation_success = false) AS failures,
  round(avg(effectiveness_score), 2) AS avg_effectiveness,
  count(*) FILTER (WHERE was_recurring = true) AS recurring_issues,
  max(created_at) AS last_seen
FROM watchdog_learnings
WHERE remediation_action IS NOT NULL
GROUP BY finding_category, remediation_action
ORDER BY count(*) DESC;
