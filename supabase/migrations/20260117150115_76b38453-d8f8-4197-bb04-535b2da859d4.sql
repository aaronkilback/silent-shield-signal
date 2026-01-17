-- Create environment settings table
CREATE TABLE public.environment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_name text NOT NULL CHECK (environment_name IN ('production', 'staging', 'test')),
  is_active boolean DEFAULT true,
  allow_untrusted_inputs boolean DEFAULT false,
  require_evidence boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.environment_config ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read environment config
CREATE POLICY "Authenticated users can read environment config"
ON public.environment_config FOR SELECT
TO authenticated
USING (true);

-- Only super admins can modify environment config
CREATE POLICY "Super admins can manage environment config"
ON public.environment_config FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Insert default production environment
INSERT INTO public.environment_config (environment_name, is_active, allow_untrusted_inputs, require_evidence)
VALUES ('production', true, false, true);

-- Create function to get user's tenant memberships
CREATE OR REPLACE FUNCTION public.get_user_tenants(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY_AGG(tenant_id) 
  FROM tenant_users 
  WHERE user_id = p_user_id;
$$;

-- Create function to check tenant membership
CREATE OR REPLACE FUNCTION public.check_tenant_access(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_users 
    WHERE user_id = p_user_id 
    AND tenant_id = p_tenant_id
  );
$$;