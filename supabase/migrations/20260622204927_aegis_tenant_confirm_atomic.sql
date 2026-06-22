-- Admin Voice Tenant Context — Fix 2: atomic single-use consume + session nonce + audit.
-- NOT YET APPLIED TO PROD (gated on post-fix review). Additive to aegis_pending_tenant_candidates.

alter table public.aegis_pending_tenant_candidates
  add column if not exists used_at timestamptz,           -- atomic single-use marker
  add column if not exists nonce text;                    -- browser/voice interaction nonce (model never sees)

-- Widen the status check to allow 'superseded' (a newer lookup in the same interaction).
alter table public.aegis_pending_tenant_candidates
  drop constraint if exists aegis_pending_tenant_candidates_status_check;
alter table public.aegis_pending_tenant_candidates
  add constraint aegis_pending_tenant_candidates_status_check
  check (status in ('pending','confirmed','expired','superseded'));

create index if not exists idx_aegis_pending_user_nonce
  on public.aegis_pending_tenant_candidates(user_id, nonce);

-- Audit: explicit, model-free record of a voice-first tenant-context selection.
create table if not exists public.aegis_tenant_context_audit (
  id uuid primary key default gen_random_uuid(),
  event text not null default 'aegis_tenant_context_established',
  user_id uuid not null,           -- actor
  tenant_id uuid not null,         -- confirmed tenant
  source text not null default 'voice',
  created_at timestamptz not null default now()
);
alter table public.aegis_tenant_context_audit enable row level security;
-- deny-all to clients; only the SECURITY DEFINER consume function writes it.

-- Atomic consume. Runs with the CALLER's auth context (auth.uid()) — call via the user's JWT.
-- SECURITY DEFINER so it can touch the deny-all pending table. Re-validates EVERYTHING at
-- confirmation time (role, membership, active tenant, expiry, nonce, single-use) inside ONE
-- UPDATE...RETURNING, so concurrent confirms / replays / revocations all yield zero rows.
create or replace function public.aegis_confirm_tenant_candidate(p_handle text, p_nonce text)
returns table (tenant_id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid;
  v_name text;
begin
  if v_uid is null then return; end if;
  -- Reauthorize: global super_admin/admin only (owner/analyst/viewer => no rows).
  if not exists (select 1 from public.user_roles where user_id = v_uid and role in ('super_admin','admin')) then
    return;
  end if;

  update public.aegis_pending_tenant_candidates p
     set used_at = now(), status = 'confirmed', confirmed_at = now()
   where p.handle = p_handle
     and p.nonce = p_nonce
     and p.user_id = v_uid
     and p.used_at is null
     and p.status = 'pending'
     and p.expires_at > now()
     and exists (select 1 from public.tenants t where t.id = p.tenant_id and t.status = 'active')
     and exists (select 1 from public.tenant_users tu where tu.tenant_id = p.tenant_id and tu.user_id = v_uid)
  returning p.tenant_id, p.display_name into v_tid, v_name;

  if v_tid is null then
    return; -- zero rows consumed => invalid/expired/superseded/revoked/concurrent-loser
  end if;

  insert into public.aegis_tenant_context_audit (event, user_id, tenant_id, source)
  values ('aegis_tenant_context_established', v_uid, v_tid, 'voice');

  return query select v_tid, v_name;
end;
$$;

revoke all on function public.aegis_confirm_tenant_candidate(text, text) from public, anon;
grant execute on function public.aegis_confirm_tenant_candidate(text, text) to authenticated;
