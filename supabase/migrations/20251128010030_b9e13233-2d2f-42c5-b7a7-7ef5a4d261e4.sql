-- Fix set_current_client to use session-level configuration
CREATE OR REPLACE FUNCTION set_current_client(client_id_param TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set the configuration at session level (true means session-local)
  PERFORM set_config('app.current_client_id', client_id_param, false);
END;
$$;