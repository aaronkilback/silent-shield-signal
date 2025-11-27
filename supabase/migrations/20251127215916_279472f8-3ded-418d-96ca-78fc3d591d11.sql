-- Drop ALL existing policies on clients table
DROP POLICY IF EXISTS "Super admins can manage all clients" ON clients;
DROP POLICY IF EXISTS "Users can view their assigned client" ON clients;
DROP POLICY IF EXISTS "Users can view clients" ON clients;
DROP POLICY IF EXISTS "Users with permissions can manage clients" ON clients;

-- Create clean, simple policies
CREATE POLICY "super_admin_full_access"
  ON clients FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "users_can_view_clients"
  ON clients FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role) OR
    has_role(auth.uid(), 'viewer'::app_role)
  );

CREATE POLICY "admin_analyst_can_insert_clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role)
  );

CREATE POLICY "admin_analyst_can_update_clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role)
  );

CREATE POLICY "admin_analyst_can_delete_clients"
  ON clients FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'analyst'::app_role)
  );