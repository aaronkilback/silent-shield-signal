-- Fix infinite recursion caused by previous migration.
-- The super_admin_bypass_user_roles policy had a subquery on user_roles inside
-- a user_roles policy, causing infinite recursion → 500 errors on all tables.
--
-- Fix: remove the broken user_roles bypass policy (the existing
-- "Users can view their own roles" policy already covers self-reads).
-- For other tables, switch to is_super_admin() which is SECURITY DEFINER
-- and bypasses RLS on user_roles, so no recursion.

-- 1. Drop the recursive user_roles policy
DROP POLICY IF EXISTS "super_admin_bypass_user_roles" ON public.user_roles;

-- 2. Re-create other bypass policies using is_super_admin() instead of raw subquery

DROP POLICY IF EXISTS "super_admin_bypass_clients" ON public.clients;
CREATE POLICY "super_admin_bypass_clients"
ON public.clients FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_signals" ON public.signals;
CREATE POLICY "super_admin_bypass_signals"
ON public.signals FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_incidents" ON public.incidents;
CREATE POLICY "super_admin_bypass_incidents"
ON public.incidents FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_entities" ON public.entities;
CREATE POLICY "super_admin_bypass_entities"
ON public.entities FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_investigations" ON public.investigations;
CREATE POLICY "super_admin_bypass_investigations"
ON public.investigations FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_ai_messages" ON public.ai_assistant_messages;
CREATE POLICY "super_admin_bypass_ai_messages"
ON public.ai_assistant_messages FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_profiles" ON public.profiles;
CREATE POLICY "super_admin_bypass_profiles"
ON public.profiles FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_bypass_sources" ON public.sources;
CREATE POLICY "super_admin_bypass_sources"
ON public.sources FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));
