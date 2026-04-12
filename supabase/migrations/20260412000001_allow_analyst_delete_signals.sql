-- Allow analysts to delete signals (previously only admin/super_admin could)
DROP POLICY IF EXISTS "Admins can delete signals" ON public.signals;

CREATE POLICY "Admins and analysts can delete signals"
ON public.signals FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);
