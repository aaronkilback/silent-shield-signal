-- Add super_admin bypass policies for all entity-related tables.
-- These tables only had analyst/admin policies, blocking super_admin users.

-- ==================== ENTITY SUGGESTIONS ====================
DROP POLICY IF EXISTS "super_admin_bypass_entity_suggestions" ON public.entity_suggestions;
CREATE POLICY "super_admin_bypass_entity_suggestions"
ON public.entity_suggestions FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== ENTITY MENTIONS ====================
DROP POLICY IF EXISTS "super_admin_bypass_entity_mentions" ON public.entity_mentions;
CREATE POLICY "super_admin_bypass_entity_mentions"
ON public.entity_mentions FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== ENTITY RELATIONSHIPS ====================
DROP POLICY IF EXISTS "super_admin_bypass_entity_relationships" ON public.entity_relationships;
CREATE POLICY "super_admin_bypass_entity_relationships"
ON public.entity_relationships FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== ENTITY NOTIFICATIONS ====================
DROP POLICY IF EXISTS "super_admin_bypass_entity_notifications" ON public.entity_notifications;
CREATE POLICY "super_admin_bypass_entity_notifications"
ON public.entity_notifications FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== ENTITY PHOTOS ====================
DROP POLICY IF EXISTS "super_admin_bypass_entity_photos" ON public.entity_photos;
CREATE POLICY "super_admin_bypass_entity_photos"
ON public.entity_photos FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));
