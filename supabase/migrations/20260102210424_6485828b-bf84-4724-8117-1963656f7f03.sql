-- Fix entities RLS policies to use same pattern as other tables
-- The entities table currently checks profiles.client_id but should use current_setting('app.current_client_id')

-- Ensure client_id column exists on entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- Drop the conflicting/redundant policies
DROP POLICY IF EXISTS "Users can view entities for their client" ON entities;
DROP POLICY IF EXISTS "Users can manage entities for their client" ON entities;
DROP POLICY IF EXISTS "Users can view entities" ON entities;
DROP POLICY IF EXISTS "Users can manage entities" ON entities;
DROP POLICY IF EXISTS "Super admins can view all entities" ON entities;
DROP POLICY IF EXISTS "Super admins can manage all entities" ON entities;
DROP POLICY IF EXISTS "Analysts and admins can manage entities" ON entities;

-- Create clean policies matching the pattern used for investigations/travelers/itineraries
CREATE POLICY "Users can view entities for their client"
ON entities FOR SELECT
USING (
  is_super_admin(auth.uid()) OR
  (
    (has_role(auth.uid(), 'analyst'::app_role) OR 
     has_role(auth.uid(), 'admin'::app_role) OR 
     has_role(auth.uid(), 'viewer'::app_role))
    AND (
      client_id IN (SELECT id FROM clients WHERE id::text = current_setting('app.current_client_id', true))
      OR current_setting('app.current_client_id', true) IS NULL
      OR current_setting('app.current_client_id', true) = ''
    )
  )
);

CREATE POLICY "Users can manage entities for their client"
ON entities FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  (
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND (
      client_id IN (SELECT id FROM clients WHERE id::text = current_setting('app.current_client_id', true))
      OR current_setting('app.current_client_id', true) IS NULL
      OR current_setting('app.current_client_id', true) = ''
    )
  )
);