-- PRODUCTION READ-ONLY EXPOSURE AUDIT — get_service_role_key anon-disclosure (P0)
-- ============================================================================================
-- SAFETY: catalog-only. This package DOES NOT invoke get_service_role_key (not even for a boolean)
-- and makes NO changes. Run against PROD (kpuqukppbmwebiptqmog) under separate authorization.
-- It determines from the catalog ALONE whether the anon plaintext-disclosure exists on prod.
-- ============================================================================================

-- (1) Does the function exist; owner / SECURITY DEFINER / search_path / schema / GRANTS / definition.
select
  to_regprocedure('public.get_service_role_key()') is not null            as fn_exists,
  pg_get_userbyid(p.proowner)                                             as owner,
  p.prosecdef                                                             as security_definer,
  coalesce(array_to_string(p.proconfig,','),'(none)')                     as search_path,
  n.nspname                                                               as schema,
  coalesce(p.proacl::text,'(default: PUBLIC EXECUTE)')                    as grants,
  (pg_get_functiondef(p.oid) ~* 'decrypted_secret')                      as reads_decrypted_secret,
  (pg_get_functiondef(p.oid) ~* 'service_role_key')                      as references_service_role_key
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_service_role_key';

-- (2) Is it reachable by untrusted REST roles? (catalog ACL check — NOT an invocation)
select grantee, 'EXECUTE granted' as note
from (
  select (aclexplode(p.proacl)).grantee::regrole::text as grantee
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_service_role_key'
) g
where grantee in ('anon','authenticated') or grantee = '-'   -- '-' = PUBLIC
;  -- ANY row here = anon/authenticated/PUBLIC can call it via PostgREST => EXPOSED.

-- (3) Migration state (when introduced).
select version from supabase_migrations.schema_migrations where version like '20260405%' order by version;

-- (4) Sibling sweep: any OTHER public SECURITY DEFINER fn executable by PUBLIC/anon/authenticated
--     that references vault/decrypted_secrets (same disclosure class).
select n.nspname||'.'||p.proname as fn, coalesce(p.proacl::text,'(PUBLIC default)') as acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
where n.nspname='public' and p.prokind in ('f','p') and l.lanname in ('plpgsql','sql') and p.prosecdef
  and pg_get_functiondef(p.oid) ~* '(decrypted_secrets|vault\.)'
  and ( p.proacl is null
        or exists(select 1 from aclexplode(p.proacl) ae where ae.privilege_type='EXECUTE'
                  and (ae.grantee=0 or ae.grantee::regrole::text in ('anon','authenticated'))) )
order by fn;

-- DECISION RULE: if (1) fn_exists AND reads_decrypted_secret AND schema='public'
--   AND (2) returns any anon/authenticated/PUBLIC row  => PROD IS EXPOSED (same P0).
--   => Required: emergency REVOKE EXECUTE FROM PUBLIC,anon,authenticated,service_role + NOTIFY pgrst,
--      then ROTATE the prod service_role_key (treat as compromised), then apply the permanent
--      DROP migration (guarded). Do NOT invoke the function. Production changes require separate authz.
