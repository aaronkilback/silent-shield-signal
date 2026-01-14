-- RLS policies for signal_correlation_groups
-- First drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can view signal correlations" ON public.signal_correlation_groups;
DROP POLICY IF EXISTS "Analysts and admins can update signal correlations" ON public.signal_correlation_groups;
DROP POLICY IF EXISTS "Analysts and admins can insert signal correlations" ON public.signal_correlation_groups;

-- Policy: authenticated users can view all signal correlation groups
CREATE POLICY "Authenticated users can view signal correlations"
ON public.signal_correlation_groups
FOR SELECT
TO authenticated
USING (true);

-- Policy: analysts and admins can update signal correlations
CREATE POLICY "Analysts and admins can update signal correlations"
ON public.signal_correlation_groups
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'analyst'::app_role)
);

-- Policy: analysts and admins can insert signal correlations
CREATE POLICY "Analysts and admins can insert signal correlations"
ON public.signal_correlation_groups
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'analyst'::app_role)
);