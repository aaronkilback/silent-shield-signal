-- Fix search_path for set_current_client function
DROP FUNCTION IF EXISTS public.set_current_client(text);

CREATE OR REPLACE FUNCTION public.set_current_client(client_id_param text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_client_id', client_id_param, false);
END;
$$;