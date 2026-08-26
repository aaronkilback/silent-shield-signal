-- P2 watchdog config-invariants: allowlist-as-data + deterministic scan function.
-- Applied to prod via MCP; committed here for git/DR parity. agent-sentinel Probe 2f calls
-- security_anon_surface_scan() daily and fires 'high' per non-empty dangerous set.
create table if not exists public.security_anon_surface_allowlist (
  id uuid primary key default gen_random_uuid(),
  invariant text not null check (invariant in
    ('rls_disabled','anon_write_policy','anon_true_read','anon_secdef_fn','anon_storage_read','public_bucket','rls_no_policy_ok')),
  identifier text not null,
  reason text not null,
  added_by text,
  added_at timestamptz not null default now(),
  unique (invariant, identifier)
);
alter table public.security_anon_surface_allowlist enable row level security;

insert into public.security_anon_surface_allowlist (invariant, identifier, reason, added_by) values
  ('rls_disabled','spatial_ref_sys','PostGIS extension-owned public reference table','audit-2026-08-02'),
  ('anon_secdef_fn','get_user_accessible_client_ids()','auth.uid()-scoped, returns [] to anon','audit-2026-08-02'),
  ('anon_secdef_fn','operator_invite_membership_check()','auth.uid()-scoped, returns [] to anon','audit-2026-08-02'),
  ('anon_secdef_fn','st_estimatedextent(text, text)','PostGIS extension function','audit-2026-08-02'),
  ('anon_secdef_fn','st_estimatedextent(text, text, text)','PostGIS extension function','audit-2026-08-02'),
  ('anon_secdef_fn','st_estimatedextent(text, text, text, boolean)','PostGIS extension function','audit-2026-08-02')
on conflict (invariant, identifier) do nothing;

create or replace function public.security_anon_surface_scan()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'rls_disabled', (select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
        and c.relname not in (select identifier from public.security_anon_surface_allowlist where invariant='rls_disabled')),
    'anon_write_policies', (select coalesce(jsonb_agg(tablename||':'||policyname order by tablename,policyname),'[]'::jsonb)
      from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
        and (roles @> array['anon']::name[]
             or (roles @> array['public']::name[] and coalesce(qual,'true')='true' and coalesce(with_check,'true')='true'))
        and (tablename||':'||policyname) not in (select identifier from public.security_anon_surface_allowlist where invariant='anon_write_policy')),
    'anon_true_read_policies', (select coalesce(jsonb_agg(tablename||':'||policyname order by tablename,policyname),'[]'::jsonb)
      from pg_policies where schemaname='public' and cmd in ('SELECT','ALL')
        and (roles @> array['anon']::name[] or roles @> array['public']::name[]) and coalesce(qual,'')='true'
        and (tablename||':'||policyname) not in (select identifier from public.security_anon_surface_allowlist where invariant='anon_true_read')),
    'anon_secdef_functions', (select coalesce(jsonb_agg(pr.proname||'('||pg_get_function_identity_arguments(pr.oid)||')' order by pr.proname),'[]'::jsonb)
      from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
      where n.nspname='public' and pr.prokind='f' and pr.prosecdef
        and has_function_privilege('anon', pr.oid, 'EXECUTE') and pg_get_function_result(pr.oid)<>'trigger'
        and (pr.proname||'('||pg_get_function_identity_arguments(pr.oid)||')') not in (select identifier from public.security_anon_surface_allowlist where invariant='anon_secdef_fn')),
    'anon_storage_read_policies', (select coalesce(jsonb_agg(policyname order by policyname),'[]'::jsonb)
      from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('SELECT','ALL')
        and (roles @> array['public']::name[] or roles @> array['anon']::name[])
        and qual !~* 'auth\.|role|jwt|tenant|user|has_|is_'
        and policyname not in (select identifier from public.security_anon_surface_allowlist where invariant='anon_storage_read')),
    'public_buckets', (select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from storage.buckets where public=true
        and name not in (select identifier from public.security_anon_surface_allowlist where invariant='public_bucket')),
    'INFO_rls_enabled_no_policy', (select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
        and c.relname not in (select identifier from public.security_anon_surface_allowlist where invariant='rls_no_policy_ok'))
  );
$$;
revoke execute on function public.security_anon_surface_scan() from anon, public;
grant execute on function public.security_anon_surface_scan() to service_role;
