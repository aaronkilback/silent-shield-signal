-- PERMANENT remediation for the anonymous service-role-key disclosure (P0, 2026-06-28).
--
-- DEFECT: public.get_service_role_key() (SECURITY DEFINER, search_path=public, public schema =
-- PostgREST-exposed) ran `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE
-- name='service_role_key'` and had EXECUTE granted to PUBLIC/anon/authenticated — so anyone with
-- the public anon key could POST /rest/v1/rpc/get_service_role_key and receive the plaintext
-- service-role key (full RLS bypass). Created by 20260405000001_secure_cron_tokens.sql.
--
-- The emergency staging fix (revoke + NOTIFY pgrst) is RUNTIME-ONLY and would be lost if a later
-- migration re-created the function. This migration makes the control DURABLE + source-controlled:
-- it removes the obsolete reader and re-asserts least-privilege on the related secret/vault funcs.
--
-- DO NOT APPLY until: (a) dependency proof remains zero (guard below enforces it), AND (b) the
-- staging service_role_key has been rotated (it must be treated as compromised). One-shot/guarded.

DO $guard$
DECLARE callers int;
BEGIN
  -- get_service_role_key must have NO DB-routine caller (all legit callers use get_current_service_role_key)
  SELECT count(*) INTO callers
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
     AND l.lanname IN ('plpgsql','sql') AND p.proname <> 'get_service_role_key'
     AND pg_get_functiondef(p.oid) ~* '\mget_service_role_key\M';
  IF callers > 0 THEN
    RAISE EXCEPTION 'ABORT: get_service_role_key still has % live DB-routine caller(s) — migrate them to get_current_service_role_key() first', callers;
  END IF;
  IF to_regprocedure('public.get_current_service_role_key()') IS NULL THEN
    RAISE EXCEPTION 'ABORT: safe replacement public.get_current_service_role_key() is absent';
  END IF;
END $guard$;

-- 1) Remove the obsolete anon-exposed plaintext service-role-key reader entirely.
DROP FUNCTION IF EXISTS public.get_service_role_key();

-- 2) Re-assert least-privilege (durable, idempotent) on the related secret/vault-referencing funcs
--    that were anon/authenticated/PUBLIC-executable. These never need API-role EXECUTE:
--      - alert_stale_secrets(): operational cron job (runs as postgres); reads secret names only.
--      - notify_entity_mentioned()/notify_incident_created(): TRIGGER functions (fire via triggers,
--        not RPC); they embed the service-role key in an outbound net.http_post header.
REVOKE EXECUTE ON FUNCTION public.alert_stale_secrets()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_entity_mentioned()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_incident_created()  FROM PUBLIC, anon, authenticated;

-- 3) Refresh the PostgREST schema cache so the dropped/!revoked routes leave the RPC surface.
NOTIFY pgrst, 'reload schema';
