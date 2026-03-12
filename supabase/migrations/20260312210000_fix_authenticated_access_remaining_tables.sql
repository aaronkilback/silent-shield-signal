-- Extend authenticated user access to remaining important tables

-- ==================== TRAVEL MODULE ====================
DROP POLICY IF EXISTS "auth_users_can_view_travelers" ON public.travelers;
CREATE POLICY "auth_users_can_view_travelers"
ON public.travelers FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_users_can_view_travel_alerts" ON public.travel_alerts;
CREATE POLICY "auth_users_can_view_travel_alerts"
ON public.travel_alerts FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_users_can_view_itineraries" ON public.itineraries;
CREATE POLICY "auth_users_can_view_itineraries"
ON public.itineraries FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_users_can_view_travel_itineraries" ON public.travel_itineraries;
CREATE POLICY "auth_users_can_view_travel_itineraries"
ON public.travel_itineraries FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== AI ASSISTANT ====================
DROP POLICY IF EXISTS "auth_users_can_view_ai_messages" ON public.ai_assistant_messages;
CREATE POLICY "auth_users_can_view_ai_messages"
ON public.ai_assistant_messages FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== MONITORING ====================
DROP POLICY IF EXISTS "auth_users_can_view_monitoring_history" ON public.monitoring_history;
CREATE POLICY "auth_users_can_view_monitoring_history"
ON public.monitoring_history FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== ALERTS ====================
DROP POLICY IF EXISTS "auth_users_can_view_alerts" ON public.alerts;
CREATE POLICY "auth_users_can_view_alerts"
ON public.alerts FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

-- ==================== ENTITY SUGGESTIONS ====================
DROP POLICY IF EXISTS "auth_users_can_view_entity_suggestions" ON public.entity_suggestions;
CREATE POLICY "auth_users_can_view_entity_suggestions"
ON public.entity_suggestions FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
