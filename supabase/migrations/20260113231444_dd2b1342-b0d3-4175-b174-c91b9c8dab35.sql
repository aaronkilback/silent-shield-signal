-- Drop existing policies
DROP POLICY IF EXISTS "Analysts and admins can view entity photos metadata" ON entity_photos;
DROP POLICY IF EXISTS "Analysts and admins can manage entity photos metadata" ON entity_photos;

-- Create updated policies that include super_admin
CREATE POLICY "Users with roles can view entity photos" 
ON entity_photos 
FOR SELECT 
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Users with roles can manage entity photos" 
ON entity_photos 
FOR ALL 
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'super_admin'::app_role)
);