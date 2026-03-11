-- Ensure super_admin has unconditional full access to all critical tables.
-- This is a belt-and-suspenders fix: adds explicit bypass policies so
-- super_admin users never get blocked by other policies or missing functions.

-- ==================== CLIENTS ====================
DROP POLICY IF EXISTS "super_admin_bypass_clients" ON public.clients;
CREATE POLICY "super_admin_bypass_clients"
ON public.clients FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== SIGNALS ====================
DROP POLICY IF EXISTS "super_admin_bypass_signals" ON public.signals;
CREATE POLICY "super_admin_bypass_signals"
ON public.signals FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== INCIDENTS ====================
DROP POLICY IF EXISTS "super_admin_bypass_incidents" ON public.incidents;
CREATE POLICY "super_admin_bypass_incidents"
ON public.incidents FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== ENTITIES ====================
DROP POLICY IF EXISTS "super_admin_bypass_entities" ON public.entities;
CREATE POLICY "super_admin_bypass_entities"
ON public.entities FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== INVESTIGATIONS ====================
DROP POLICY IF EXISTS "super_admin_bypass_investigations" ON public.investigations;
CREATE POLICY "super_admin_bypass_investigations"
ON public.investigations FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== AI ASSISTANT MESSAGES ====================
DROP POLICY IF EXISTS "super_admin_bypass_ai_messages" ON public.ai_assistant_messages;
CREATE POLICY "super_admin_bypass_ai_messages"
ON public.ai_assistant_messages FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== PROFILES ====================
DROP POLICY IF EXISTS "super_admin_bypass_profiles" ON public.profiles;
CREATE POLICY "super_admin_bypass_profiles"
ON public.profiles FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== USER ROLES (self-read) ====================
DROP POLICY IF EXISTS "super_admin_bypass_user_roles" ON public.user_roles;
CREATE POLICY "super_admin_bypass_user_roles"
ON public.user_roles FOR ALL
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ==================== SOURCES ====================
DROP POLICY IF EXISTS "super_admin_bypass_sources" ON public.sources;
CREATE POLICY "super_admin_bypass_sources"
ON public.sources FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
);
