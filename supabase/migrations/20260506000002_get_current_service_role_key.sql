-- get_current_service_role_key — May 6 2026.
--
-- Edge functions need a current service-role key to invoke other
-- edge functions. The Deno env var SUPABASE_SERVICE_ROLE_KEY holds
-- the LEGACY JWT format (missing the `sub` claim) on this project,
-- which the new Supabase auth layer rejects with 401 — see
-- auto-orchestrator producing 77 "Monitor X failed: Unauthorized"
-- errors / 6h, with monitor-wildfires + ~22 other monitors silently
-- non-firing.
--
-- The current rotated key lives in `vault.decrypted_secrets` under
-- the name `service_role_key` (used today by cron jobs that work).
-- This RPC exposes it to edge functions. SECURITY DEFINER + RLS-
-- locked + service-role-only invocation so the secret doesn't leak.
--
-- Usage from edge function:
--   const { data } = await supabase.rpc('get_current_service_role_key');
--   const serviceKey = data ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
-- Cache the value within a single function invocation; don't write
-- it to logs.

CREATE OR REPLACE FUNCTION public.get_current_service_role_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text;
BEGIN
  -- Resolve the current service-role key from vault. If vault is
  -- unavailable for any reason, return null so callers fall back to
  -- the env var (which is what they were already using before).
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;
  RETURN v_key;
END;
$$;

-- Lock it down — only service-role contexts should call this.
REVOKE ALL ON FUNCTION public.get_current_service_role_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_service_role_key() FROM anon;
REVOKE ALL ON FUNCTION public.get_current_service_role_key() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_service_role_key() TO service_role;

COMMENT ON FUNCTION public.get_current_service_role_key() IS
  'Returns the current service-role key from vault.decrypted_secrets. Edge functions use this when their Deno env var SUPABASE_SERVICE_ROLE_KEY holds the legacy JWT format that auth rejects with 401. service_role only — never expose to anon/authenticated.';
