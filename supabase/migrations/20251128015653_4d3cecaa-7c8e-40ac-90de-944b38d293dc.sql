-- Fix RLS policies to properly handle super_admin viewing all client data
-- The issue: super_admin users with a specific client_id in their profile
-- are still restricted to only seeing that client's data

-- Drop and recreate investigations policies
DROP POLICY IF EXISTS "Users can view investigations for their client" ON investigations;
DROP POLICY IF EXISTS "Users can manage investigations for their client" ON investigations;

CREATE POLICY "Users can view investigations for their client"
ON investigations FOR SELECT
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

CREATE POLICY "Users can manage investigations for their client"
ON investigations FOR ALL
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

-- Drop and recreate travelers policies
DROP POLICY IF EXISTS "Users can view travelers for their client" ON travelers;
DROP POLICY IF EXISTS "Users can manage travelers for their client" ON travelers;

CREATE POLICY "Users can view travelers for their client"
ON travelers FOR SELECT
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

CREATE POLICY "Users can manage travelers for their client"
ON travelers FOR ALL
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

-- Drop and recreate itineraries policies
DROP POLICY IF EXISTS "Users can view itineraries for their client" ON itineraries;
DROP POLICY IF EXISTS "Users can manage itineraries for their client" ON itineraries;

CREATE POLICY "Users can view itineraries for their client"
ON itineraries FOR SELECT
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

CREATE POLICY "Users can manage itineraries for their client"
ON itineraries FOR ALL
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