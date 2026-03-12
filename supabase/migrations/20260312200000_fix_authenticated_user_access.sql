-- Fix: ensure any authenticated user can access all data
-- Context: single-operator security platform, 1 user, all data belongs to them
-- Root cause: is_super_admin() bypass may fail if auth.uid() doesn't match
-- hardcoded user_id from older migration. Belt-and-suspenders: also allow
-- any authenticated user to access all records.

-- ==================== ENSURE USER HAS SUPER_ADMIN ROLE ====================
-- Insert super_admin role for ALL current auth users who have no role yet.
-- This is idempotent: ON CONFLICT DO NOTHING.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::app_role
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ==================== SIGNALS ====================
DROP POLICY IF EXISTS "auth_users_can_view_signals" ON public.signals;
CREATE POLICY "auth_users_can_view_signals"
ON public.signals FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== INCIDENTS ====================
DROP POLICY IF EXISTS "auth_users_can_view_incidents" ON public.incidents;
CREATE POLICY "auth_users_can_view_incidents"
ON public.incidents FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== CLIENTS ====================
DROP POLICY IF EXISTS "auth_users_can_view_clients" ON public.clients;
CREATE POLICY "auth_users_can_view_clients"
ON public.clients FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== ENTITIES ====================
DROP POLICY IF EXISTS "auth_users_can_view_entities" ON public.entities;
CREATE POLICY "auth_users_can_view_entities"
ON public.entities FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== SIGNAL_CORRELATION_GROUPS ====================
-- Already has USING(true) policy but be explicit
DROP POLICY IF EXISTS "auth_users_can_view_correlation_groups" ON public.signal_correlation_groups;
CREATE POLICY "auth_users_can_view_correlation_groups"
ON public.signal_correlation_groups FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== SOURCES ====================
DROP POLICY IF EXISTS "auth_users_can_view_sources" ON public.sources;
CREATE POLICY "auth_users_can_view_sources"
ON public.sources FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== INVESTIGATIONS ====================
DROP POLICY IF EXISTS "auth_users_can_view_investigations" ON public.investigations;
CREATE POLICY "auth_users_can_view_investigations"
ON public.investigations FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== PROFILES ====================
DROP POLICY IF EXISTS "auth_users_can_view_profiles" ON public.profiles;
CREATE POLICY "auth_users_can_view_profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== THREAT RADAR SNAPSHOTS ====================
DROP POLICY IF EXISTS "auth_users_can_view_threat_radar" ON public.threat_radar_snapshots;
CREATE POLICY "auth_users_can_view_threat_radar"
ON public.threat_radar_snapshots FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);
