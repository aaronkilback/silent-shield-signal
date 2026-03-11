-- Add super_admin bypass policies for travel tables.
-- The original policies only allow analyst/admin roles, which excludes super_admin users.
-- Using is_super_admin() (SECURITY DEFINER) to avoid RLS recursion on user_roles.

-- ==================== TRAVELERS ====================
DROP POLICY IF EXISTS "super_admin_bypass_travelers" ON public.travelers;
CREATE POLICY "super_admin_bypass_travelers"
ON public.travelers FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== ITINERARIES ====================
DROP POLICY IF EXISTS "super_admin_bypass_itineraries" ON public.itineraries;
CREATE POLICY "super_admin_bypass_itineraries"
ON public.itineraries FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- ==================== TRAVEL ALERTS ====================
DROP POLICY IF EXISTS "super_admin_bypass_travel_alerts" ON public.travel_alerts;
CREATE POLICY "super_admin_bypass_travel_alerts"
ON public.travel_alerts FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));
