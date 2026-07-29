-- WO-SENTINEL item 4a ruling: anon executes definer fns via default PUBLIC grant. REVOKE FROM
-- PUBLIC + re-GRANT authenticated,service_role, EXCEPT the RLS-predicate + auth/signup keep-set
-- (needed for RLS evaluation). 101 -> 26 anon-executable. Applied prod 2026-07-29.
do $$
declare r record;
  keep text[] := array['can_share_to_consortium','get_user_accessible_client_ids','has_consortium_role','has_role','has_tenant_role','is_consortium_member','is_conversation_participant','is_muted','is_super_admin','is_tenant_admin_or_owner','is_tenant_member','is_workspace_contributor','is_workspace_creator','is_workspace_member','is_workspace_owner','check_tenant_access','get_user_tenant_ids','get_user_consortium_ids','get_user_tenants','has_mcm_permission','handle_new_user','handle_new_user_role'];
begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid,'EXECUTE') and not (p.proname = any(keep))
  loop
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
  end loop;
end $$;
