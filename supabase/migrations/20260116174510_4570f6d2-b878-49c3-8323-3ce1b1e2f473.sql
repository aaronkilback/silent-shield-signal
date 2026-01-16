-- Drop existing policies
DROP POLICY IF EXISTS "Analysts and admins can manage entity suggestions" ON public.entity_suggestions;
DROP POLICY IF EXISTS "Analysts and admins can view entity suggestions" ON public.entity_suggestions;

-- Create updated policies that include super_admin
CREATE POLICY "Users can view entity suggestions"
ON public.entity_suggestions
FOR SELECT
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR
  is_super_admin(auth.uid())
);

CREATE POLICY "Users can manage entity suggestions"
ON public.entity_suggestions
FOR ALL
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR
  is_super_admin(auth.uid())
);