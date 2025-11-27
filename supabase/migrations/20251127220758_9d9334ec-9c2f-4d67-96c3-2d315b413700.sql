-- Create function to set current client context
CREATE OR REPLACE FUNCTION public.set_current_client(client_id_param text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_client_id', client_id_param, false);
END;
$$;