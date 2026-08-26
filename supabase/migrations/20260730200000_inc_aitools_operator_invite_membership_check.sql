-- INC-AITOOLS-XTENANT-2026-07-30 watchdog probe (e): operator_invites whose creator is NOT a member
-- of the invited client's tenant = cross-tenant invite (the create-operator-invite escalation shape).
-- Applied to prod via single-file apply_migration 2026-07-30 (no db push; ledger prohibition).
create or replace function public.operator_invite_membership_check()
returns table(invite_id uuid, created_by uuid, client_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select oi.id, oi.created_by, oi.client_id, c.tenant_id
  from public.operator_invites oi
  join public.clients c on c.id = oi.client_id
  left join public.tenant_users tu on tu.user_id = oi.created_by and tu.tenant_id = c.tenant_id
  where oi.client_id is not null and tu.user_id is null
$function$;

revoke all on function public.operator_invite_membership_check() from anon, authenticated;
