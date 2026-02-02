-- Fix permissive RLS policies for audit/dissemination tables
-- These should only allow inserts from authenticated users or service role

-- Drop overly permissive policies
DROP POLICY IF EXISTS "System can insert dissemination records" ON public.intel_dissemination_log;
DROP POLICY IF EXISTS "System can insert audit records" ON public.consortium_audit_log;

-- Create properly scoped insert policies
CREATE POLICY "Authenticated users can insert dissemination records"
ON public.intel_dissemination_log FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
);

CREATE POLICY "Authenticated users can insert audit records"
ON public.consortium_audit_log FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
);