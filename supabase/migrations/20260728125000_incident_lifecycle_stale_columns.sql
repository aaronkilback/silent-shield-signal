-- WO-INCIDENT-QA Step 4: stale-tracking columns for incident lifecycle.
alter table public.incidents add column if not exists is_stale boolean not null default false;
alter table public.incidents add column if not exists stale_since timestamptz;
create index if not exists idx_incidents_open_lifecycle
  on public.incidents (status) where status = 'open';
