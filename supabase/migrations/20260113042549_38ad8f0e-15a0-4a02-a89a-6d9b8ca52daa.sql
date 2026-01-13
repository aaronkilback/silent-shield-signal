-- Fix overly permissive RLS policy on sources table
-- Replace the permissive policy with role-based access control

DROP POLICY IF EXISTS "Authenticated users can manage sources" ON public.sources;

-- Create policy for analysts and admins to manage sources
CREATE POLICY "Analysts and admins can manage sources"
ON public.sources FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'super_admin'::app_role)
);

-- Create read-only policy for viewers
CREATE POLICY "Viewers can read sources"
ON public.sources FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'viewer'::app_role));

COMMENT ON POLICY "Analysts and admins can manage sources" ON public.sources IS 'Restricts source management to analysts, admins, and super_admins. Viewers can only read sources.';