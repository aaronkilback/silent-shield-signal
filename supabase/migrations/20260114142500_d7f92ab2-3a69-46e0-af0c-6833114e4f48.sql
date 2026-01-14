-- =====================================================
-- SECURITY FIX: Fix remaining overly permissive policies
-- =====================================================

-- 1. TRAVEL_ALERTS: Fix service role policy (was using public role)
DROP POLICY IF EXISTS "Service role can manage travel alerts" ON public.travel_alerts;
CREATE POLICY "Service role manages travel alerts"
ON public.travel_alerts FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. TASK_FORCE_CONTRIBUTIONS: Replace overly permissive INSERT policy
DROP POLICY IF EXISTS "System can create contributions" ON public.task_force_contributions;
CREATE POLICY "Admins and analysts can insert contributions"
ON public.task_force_contributions FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

-- Add service role policy for task_force_contributions
CREATE POLICY "Service role manages task force contributions"
ON public.task_force_contributions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);