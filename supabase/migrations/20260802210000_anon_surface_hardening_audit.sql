-- Anon-surface hardening — apex-audit ruling P0/P1/P2 (2026-08-02).
-- Applied to prod (kpuqukppbmwebiptqmog) individually via MCP apply_migration; consolidated here
-- for git/DR parity. Every change was proven with an empirical anon probe (see session record).

-- P0 — close the anon INSERT vector: 5 policies were named "Service role..." but scoped TO public
-- (incl. anon) with WITH CHECK (true). Re-scope to service_role (which bypasses RLS anyway).
alter policy "Service role can insert proposals"        on public.monitoring_proposals   to service_role;
alter policy "Service can insert edge function errors"  on public.edge_function_errors   to service_role;
alter policy "Service role can insert scan history"     on public.itinerary_scan_history to service_role;
alter policy "Service role full access briefings"       on public.briefing_sessions      to service_role;
alter policy "Service role can insert signal updates"   on public.signal_updates         to service_role;

-- P1 — revoke anon EXECUTE on auth-graph oracles + cron-registry dump + grounding helper.
-- These are RLS helpers used by 175 TO-public policies, so authenticated MUST retain EXECUTE
-- (else authenticated RLS eval breaks). Pattern: revoke anon+public, re-grant authenticated+service_role.
-- Left untouched: auth.uid()-scoped no-arg variants + PostGIS st_estimatedextent (see allowlist).
do $$
declare s text;
begin
  foreach s in array array[
    'registry_phantom_check()',
    'get_user_accessible_client_ids(uuid)','get_user_tenant_ids(uuid)','get_user_tenants(uuid)',
    'is_super_admin(uuid)','has_role(uuid, app_role)',
    'can_share_to_consortium(uuid, uuid)','check_tenant_access(uuid, uuid)','get_user_consortium_ids(uuid)',
    'grounding_resolve_asset_links(uuid, uuid[])',
    'has_consortium_role(uuid, uuid, consortium_role[])','has_mcm_permission(uuid, uuid, workspace_mcm_role[])',
    'has_tenant_role(uuid, uuid, tenant_role[])','is_consortium_member(uuid, uuid)','is_conversation_participant(uuid, uuid)',
    'is_muted(uuid)','is_tenant_admin_or_owner(uuid, uuid)','is_tenant_member(uuid, uuid)',
    'is_workspace_contributor(uuid, uuid)','is_workspace_creator(uuid, uuid)','is_workspace_member(uuid, uuid)','is_workspace_owner(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from anon, public', s);
    execute format('grant execute on function public.%s to authenticated, service_role', s);
  end loop;
end $$;

-- P1 — storage: 3 SELECT policies granted anon read by bucket_id with no auth check. Re-scope to
-- authenticated (buckets are empty, no object breakage). message-attachments should ideally be
-- tenant/participant-scoped (follow-up).
alter policy "Agent avatars are publicly accessible" on storage.objects to authenticated;
alter policy "Email assets public read"              on storage.objects to authenticated;
alter policy "Public read access to attachments"     on storage.objects to authenticated;

-- P2 — config-invariant allowlist (DATA) + deterministic scan function are in a separate migration:
--   20260802210500_security_anon_surface_invariants.sql
