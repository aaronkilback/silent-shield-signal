-- Update the handle_new_user function to assign analyst role by default
-- instead of viewer role for this security intelligence system

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert into profiles (without role)
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  );
  
  -- Insert default analyst role in user_roles (changed from viewer)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'analyst'::app_role);
  
  RETURN NEW;
END;
$function$;