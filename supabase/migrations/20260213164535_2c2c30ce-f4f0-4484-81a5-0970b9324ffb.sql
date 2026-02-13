-- Fix investigation_entries RLS: add WITH CHECK and super_admin bypass
DROP POLICY "Analysts and admins can manage investigation entries" ON public.investigation_entries;
DROP POLICY "Analysts and admins can view investigation entries" ON public.investigation_entries;

CREATE POLICY "Analysts and admins can manage investigation entries"
  ON public.investigation_entries FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));