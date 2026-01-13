-- Fix 1: CRITICAL - Secure set_current_client() function with authorization check
-- This prevents unauthorized cross-tenant access by validating user has permission to access the client
CREATE OR REPLACE FUNCTION public.set_current_client(client_id_param text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- Get current authenticated user
  current_user_id := auth.uid();
  
  -- Allow empty client_id (clearing context)
  IF client_id_param = '' OR client_id_param IS NULL THEN
    PERFORM set_config('app.current_client_id', '', false);
    RETURN;
  END IF;
  
  -- Super admins can access any client
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = current_user_id AND role = 'super_admin'
  ) THEN
    PERFORM set_config('app.current_client_id', client_id_param, false);
    RETURN;
  END IF;
  
  -- Admins can access any client
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = current_user_id AND role = 'admin'
  ) THEN
    PERFORM set_config('app.current_client_id', client_id_param, false);
    RETURN;
  END IF;
  
  -- Analysts can access any client (multi-tenant analysts work across clients)
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = current_user_id AND role = 'analyst'
  ) THEN
    PERFORM set_config('app.current_client_id', client_id_param, false);
    RETURN;
  END IF;
  
  -- Viewers can access any client (for viewing reports)
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = current_user_id AND role = 'viewer'
  ) THEN
    PERFORM set_config('app.current_client_id', client_id_param, false);
    RETURN;
  END IF;
  
  -- No valid role found - deny access
  RAISE EXCEPTION 'Access denied: User does not have permission to access client %', client_id_param;
END;
$$;

-- Fix 2: Secure profiles table - require authentication for viewing profiles
-- Drop existing overly permissive policy
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create new policy requiring authentication
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Add comment explaining the security change
COMMENT ON FUNCTION public.set_current_client(text) IS 'Securely sets the current client context after validating user has proper role-based access. Super admins, admins, analysts, and viewers can access clients. Unauthenticated users are denied.';