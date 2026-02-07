
-- Fix pipeline_test_results: restrict to admins only
DROP POLICY IF EXISTS "Authenticated users can view pipeline tests" ON public.pipeline_test_results;
DROP POLICY IF EXISTS "Service role can manage pipeline tests" ON public.pipeline_test_results;

CREATE POLICY "Admins can view pipeline test results"
ON public.pipeline_test_results FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Admins can manage pipeline test results"
ON public.pipeline_test_results FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid())
);

-- Fix source_artifacts: drop the overly broad policy
DROP POLICY IF EXISTS "Authenticated users can view source artifacts" ON public.source_artifacts;
