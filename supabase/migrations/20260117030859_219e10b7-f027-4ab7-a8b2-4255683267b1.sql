-- Fix overly permissive RLS policies
DROP POLICY IF EXISTS "System can insert activity" ON public.tenant_activity;

-- Replace with proper policy that validates tenant membership
CREATE POLICY "Tenant members can insert activity" ON public.tenant_activity
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    OR public.is_super_admin(auth.uid())
  );