-- Fix: Add WITH CHECK to the ALL policy so INSERT/UPDATE works
DROP POLICY "Analysts and admins can manage investigation persons" ON public.investigation_persons;

CREATE POLICY "Analysts and admins can manage investigation persons"
  ON public.investigation_persons FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));