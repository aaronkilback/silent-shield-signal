-- Admin Voice Tenant Context: short-lived, server-held pending tenant candidates.
-- (Applied to prod via MCP apply_migration on 2026-06-22; committed for repo/CI parity.)
create table if not exists public.aegis_pending_tenant_candidates (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null,
  authorized_role text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index if not exists idx_aegis_pending_user_status on public.aegis_pending_tenant_candidates(user_id, status);
create index if not exists idx_aegis_pending_handle on public.aegis_pending_tenant_candidates(handle);
alter table public.aegis_pending_tenant_candidates enable row level security;
-- No authenticated/anon policies => deny-all to clients (fail-closed). Service role bypasses.
