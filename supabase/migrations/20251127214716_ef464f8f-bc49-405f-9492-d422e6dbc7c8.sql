-- Step 2: Update role and create client-scoped policies

-- Update your account to super_admin
UPDATE user_roles 
SET role = 'super_admin'
WHERE user_id = 'cb53c22f-9f53-4dde-a583-4b6ff9c21063';

-- Create helper function to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'super_admin'
  )
$$;

-- Update signals RLS policies to be client-scoped
DROP POLICY IF EXISTS "Analysts and admins can manage signals" ON signals;
DROP POLICY IF EXISTS "Analysts and admins can view signals" ON signals;

CREATE POLICY "Users can manage signals for their client"
  ON signals FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) AND
      (
        client_id IN (SELECT id FROM clients WHERE (id)::text = current_setting('app.current_client_id', true)) OR
        current_setting('app.current_client_id', true) IS NULL OR
        current_setting('app.current_client_id', true) = ''
      )
    )
  );

CREATE POLICY "Users can view signals for their client"
  ON signals FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'viewer'::app_role)) AND
      (
        client_id IN (SELECT id FROM clients WHERE (id)::text = current_setting('app.current_client_id', true)) OR
        current_setting('app.current_client_id', true) IS NULL OR
        current_setting('app.current_client_id', true) = ''
      )
    )
  );

-- Update incidents RLS policies
DROP POLICY IF EXISTS "Analysts and admins can manage incidents" ON incidents;
DROP POLICY IF EXISTS "Analysts and admins can view incidents" ON incidents;

CREATE POLICY "Users can manage incidents for their client"
  ON incidents FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) AND
      (
        client_id IN (SELECT id FROM clients WHERE (id)::text = current_setting('app.current_client_id', true)) OR
        current_setting('app.current_client_id', true) IS NULL OR
        current_setting('app.current_client_id', true) = ''
      )
    )
  );

CREATE POLICY "Users can view incidents for their client"
  ON incidents FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    (
      (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'viewer'::app_role)) AND
      (
        client_id IN (SELECT id FROM clients WHERE (id)::text = current_setting('app.current_client_id', true)) OR
        current_setting('app.current_client_id', true) IS NULL OR
        current_setting('app.current_client_id', true) = ''
      )
    )
  );

-- Update entities RLS policies (entities don't have client_id, so super_admin and regular access)
DROP POLICY IF EXISTS "Analysts and admins can create entities" ON entities;
DROP POLICY IF EXISTS "Analysts and admins can delete entities" ON entities;
DROP POLICY IF EXISTS "Analysts and admins can update entities" ON entities;
DROP POLICY IF EXISTS "Analysts and admins can view entities" ON entities;
DROP POLICY IF EXISTS "Users can manage entities" ON entities;
DROP POLICY IF EXISTS "Users can view entities" ON entities;

CREATE POLICY "Users can manage entities"
  ON entities FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    has_role(auth.uid(), 'analyst'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Users can view entities"
  ON entities FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    has_role(auth.uid(), 'analyst'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'viewer'::app_role)
  );

-- Update clients table RLS
DROP POLICY IF EXISTS "Analysts and admins can manage clients" ON clients;
DROP POLICY IF EXISTS "Analysts and admins can view clients" ON clients;

CREATE POLICY "Super admins can manage all clients"
  ON clients FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Users can view their assigned client"
  ON clients FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid()) OR
    (
      id IN (SELECT client_id FROM profiles WHERE id = auth.uid())
    )
  );

-- Update profiles RLS to allow super admins
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

CREATE POLICY "Super admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update all profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Admins can view profiles in their client"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) AND
    client_id IN (SELECT client_id FROM profiles WHERE id = auth.uid())
  );