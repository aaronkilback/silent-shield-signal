
-- Fix intelligence_config RLS to include super_admin
DROP POLICY IF EXISTS "Analysts and admins full access to intelligence_config" ON public.intelligence_config;
CREATE POLICY "Analysts admins and super_admins full access to intelligence_config"
ON public.intelligence_config
FOR ALL
USING (
  has_role(auth.uid(), 'analyst'::app_role) 
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_super_admin(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role) 
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_super_admin(auth.uid())
);

-- Fix monitoring_proposals UPDATE policy (already includes super_admin but add WITH CHECK)
DROP POLICY IF EXISTS "Admins can update proposals" ON public.monitoring_proposals;
CREATE POLICY "Admins can update proposals"
ON public.monitoring_proposals
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'analyst'::app_role) 
  OR is_super_admin(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'analyst'::app_role) 
  OR is_super_admin(auth.uid())
);
