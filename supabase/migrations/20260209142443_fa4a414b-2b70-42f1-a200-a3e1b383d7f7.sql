-- Fix: Allow super_admin to also manage travel alerts
DROP POLICY IF EXISTS "Analysts and admins can manage travel alerts" ON public.travel_alerts;
CREATE POLICY "Authorized roles can manage travel alerts"
ON public.travel_alerts
FOR ALL
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "Analysts and admins can view travel alerts" ON public.travel_alerts;
CREATE POLICY "Authorized roles can view travel alerts"
ON public.travel_alerts
FOR SELECT
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);