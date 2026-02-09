
-- Fix: FOR ALL policy needs WITH CHECK clause for updates/inserts
DROP POLICY IF EXISTS "Authorized roles can manage travel alerts" ON public.travel_alerts;
CREATE POLICY "Authorized roles can manage travel alerts"
ON public.travel_alerts
FOR ALL
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);
