
-- Fix RLS policies for travelers and itineraries to include super_admin bypass
-- This ensures super_admin users can see all data across all clients

-- Drop existing policies for travelers
DROP POLICY IF EXISTS "Users can manage travelers for their client" ON travelers;
DROP POLICY IF EXISTS "Users can view travelers for their client" ON travelers;

-- Create new policies for travelers with super_admin bypass
CREATE POLICY "Users can manage travelers for their client"
  ON travelers
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR 
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) 
      AND (
        client_id = (SELECT client_id FROM profiles WHERE id = auth.uid()) 
        OR (SELECT client_id FROM profiles WHERE id = auth.uid()) IS NULL
      )
    )
  );

CREATE POLICY "Users can view travelers for their client"
  ON travelers
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR 
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'viewer'::app_role)) 
      AND (
        client_id = (SELECT client_id FROM profiles WHERE id = auth.uid()) 
        OR (SELECT client_id FROM profiles WHERE id = auth.uid()) IS NULL
      )
    )
  );

-- Drop existing policies for itineraries
DROP POLICY IF EXISTS "Users can manage itineraries for their client" ON itineraries;
DROP POLICY IF EXISTS "Users can view itineraries for their client" ON itineraries;

-- Create new policies for itineraries with super_admin bypass
CREATE POLICY "Users can manage itineraries for their client"
  ON itineraries
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR 
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) 
      AND (
        client_id = (SELECT client_id FROM profiles WHERE id = auth.uid()) 
        OR (SELECT client_id FROM profiles WHERE id = auth.uid()) IS NULL
      )
    )
  );

CREATE POLICY "Users can view itineraries for their client"
  ON itineraries
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR 
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'viewer'::app_role)) 
      AND (
        client_id = (SELECT client_id FROM profiles WHERE id = auth.uid()) 
        OR (SELECT client_id FROM profiles WHERE id = auth.uid()) IS NULL
      )
    )
  );
