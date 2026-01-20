-- Fix remaining RLS policies with (true) for INSERT operations

-- 1. Fix audit_events - require auth or service role
DROP POLICY IF EXISTS "System can insert audit events" ON public.audit_events;

CREATE POLICY "Authenticated users and system can insert audit events"
ON public.audit_events
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL OR current_setting('role', true) = 'service_role');

-- 2. Fix content_violations - require auth or service role  
DROP POLICY IF EXISTS "System can insert violations" ON public.content_violations;

CREATE POLICY "Authenticated users and system can insert violations"
ON public.content_violations
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL OR current_setting('role', true) = 'service_role');

-- 3. Fix report_evidence_sources - require auth or service role
DROP POLICY IF EXISTS "System can insert evidence sources" ON public.report_evidence_sources;

CREATE POLICY "Authenticated users and system can insert evidence sources"
ON public.report_evidence_sources
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL OR current_setting('role', true) = 'service_role');