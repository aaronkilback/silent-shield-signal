-- Fix RLS policies for entity_relationships to allow analysts and admins to manage relationships

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Service role can manage relationships" ON entity_relationships;
DROP POLICY IF EXISTS "Analysts and admins can view relationships" ON entity_relationships;

-- Create new policies that allow analysts and admins to manage relationships
CREATE POLICY "Analysts and admins can view relationships"
ON entity_relationships
FOR SELECT
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Analysts and admins can create relationships"
ON entity_relationships
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Analysts and admins can update relationships"
ON entity_relationships
FOR UPDATE
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Analysts and admins can delete relationships"
ON entity_relationships
FOR DELETE
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

-- Also allow service role full access for automated processes
CREATE POLICY "Service role can manage all relationships"
ON entity_relationships
FOR ALL
USING (true);

-- Add comment
COMMENT ON TABLE entity_relationships IS 'Entity relationships can be created manually by analysts/admins or automatically by AI scanning';