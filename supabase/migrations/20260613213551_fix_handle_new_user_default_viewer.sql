-- Reconciliation of MCP-applied migration (prod history version 20260613213551).
-- Root fix for the privilege-by-default defect: new signups default to least-privilege
-- 'viewer', NOT 'analyst'. Operator (analyst/admin) access is granted explicitly, never
-- by signup default. Existing role assignments untouched (no DML on user_roles).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;
