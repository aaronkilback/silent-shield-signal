-- Diagnostic capture of the pre-cluster findings set (gated on a debug flag). Lets us see exactly what
-- was retrieved + verified + classified, and which survived clustering — before touching the clusterer.
create table if not exists public.subject_scan_findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null,
  subject_entity_id uuid,
  url text, domain text, title text, snippet text,
  source_class text, phase smallint, found_at_rank int,
  found_by_query text,
  clustered boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.subject_scan_findings enable row level security;
create index if not exists ssf_scan_idx on public.subject_scan_findings (scan_id);
