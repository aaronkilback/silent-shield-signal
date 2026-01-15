-- Fix the overly permissive INSERT policy on briefing_query_sources
DROP POLICY IF EXISTS "System can insert sources" ON public.briefing_query_sources;

-- Create a proper policy that allows service role or authenticated users inserting for their own queries
CREATE POLICY "Users can insert sources for their own queries"
ON public.briefing_query_sources FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.briefing_queries q
    WHERE q.id = query_id
    AND (q.asked_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
    ))
  )
);