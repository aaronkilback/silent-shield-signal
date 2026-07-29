-- WO-SENTINEL-1: RLS posture surface (applied prod 2026-07-29).
create or replace function public.sentinel_rls_posture()
returns table(table_name text, rls_disabled boolean, anon_readable boolean)
language sql stable as $$
  select c.relname::text, (c.relrowsecurity = false), has_table_privilege('anon', c.oid, 'SELECT')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    and c.relname <> 'spatial_ref_sys'
  order by 1;
$$;
