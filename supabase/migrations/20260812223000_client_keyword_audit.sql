-- Reversible/auditable keyword governance (STEP 2, 2026-08-12). Records deactivate/add of a
-- client's monitoring_keywords with a reason, so array edits are auditable and reversible.
-- Applied to prod via execute_sql 2026-08-12; this file captures it for git/DR parity.
create table if not exists public.client_keyword_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  keyword text not null,
  action text not null,            -- 'deactivated' | 'added'
  reason text,
  changed_by text,
  changed_at timestamptz default now()
);
alter table public.client_keyword_audit enable row level security;  -- RLS-at-Creation
