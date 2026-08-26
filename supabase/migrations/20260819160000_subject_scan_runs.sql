-- Async scan tracking (fire-and-persist requirement, operator 2026-08-19). A fired background scan must be
-- VISIBLE as started-and-never-finished if it dies mid-run — not silently absent (the fire-and-forget
-- failure pattern found 4× this week). Row is written 'started' BEFORE work; 'completed'/'failed' at the
-- end. A platform SIGKILL leaves it stuck at 'started' — which is exactly the desired died-mid-run signal.
create table if not exists public.subject_scan_runs (
  id uuid primary key,                       -- = scanId (same id used in subject_exposure_items.scan_id)
  subject_entity_id uuid,
  subject_name text not null,
  owner_client_id uuid,
  owner_tenant_id uuid,
  scope jsonb,
  status text not null default 'started' check (status in ('started','completed','failed')),
  counts jsonb,
  error text,
  fired_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS-at-Creation (standing rule): enabled here; deny-by-default, service-role writers only.
alter table public.subject_scan_runs enable row level security;
create index if not exists ssr_subject_idx on public.subject_scan_runs (subject_entity_id);
-- find stuck scans (started but never finished) — the liveness query a watchdog probe would run.
create index if not exists ssr_status_started_idx on public.subject_scan_runs (status, started_at);
