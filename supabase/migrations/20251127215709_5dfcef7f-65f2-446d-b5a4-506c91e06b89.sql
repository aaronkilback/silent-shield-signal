-- Drop old policies that don't include super_admin
DROP POLICY IF EXISTS "Admins and analysts can manage clients" ON clients;
DROP POLICY IF EXISTS "Analysts and admins can view clients" ON clients;

-- Create comprehensive policies that include super_admin
CREATE POLICY "Users with permissions can manage clients"
  ON clients FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role)
  );

CREATE POLICY "Users can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role) OR
    has_role(auth.uid(), 'viewer'::app_role) OR
    (id IN (SELECT client_id FROM profiles WHERE id = auth.uid()))
  );