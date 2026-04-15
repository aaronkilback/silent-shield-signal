-- Fix: analysts and admins can only SELECT correlation groups (no UPDATE/DELETE policy existed).
-- Dismiss, noise, and delete operations in the Signals UI were silently blocked by RLS —
-- the mutation returned no error but 0 rows affected, so the signal stayed in the feed.

CREATE POLICY "Analysts and admins can update correlation groups"
  ON public.signal_correlation_groups FOR UPDATE
  TO authenticated
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

CREATE POLICY "Analysts and admins can delete correlation groups"
  ON public.signal_correlation_groups FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );
