-- Codebase snapshot table
-- Stores source files so the AI assistant (Aegis) can audit the codebase
-- and understand the current implementation state before making recommendations.
-- Populated by scripts/sync-codebase-snapshot.ts — run locally after changes.

create table if not exists codebase_snapshot (
  id           uuid primary key default gen_random_uuid(),
  file_path    text not null unique,   -- e.g. supabase/functions/ingest-signal/index.ts
  file_type    text not null,          -- 'edge_function' | 'shared' | 'config' | 'doc'
  function_name text,                  -- edge function name if applicable
  content      text not null,
  byte_size    integer generated always as (octet_length(content)) stored,
  updated_at   timestamptz not null default now()
);

-- Index for fast manifest queries (list without content)
create index if not exists codebase_snapshot_type_idx on codebase_snapshot (file_type, function_name);

-- Service role only — no user-facing RLS needed
alter table codebase_snapshot enable row level security;

create policy "service_role_full_access" on codebase_snapshot
  using (true)
  with check (true);

-- Comment for documentation
comment on table codebase_snapshot is
  'Source file mirror for Aegis codebase audit. Populated by scripts/sync-codebase-snapshot.ts. Queried by list_source_files and get_source_file Aegis tools.';
