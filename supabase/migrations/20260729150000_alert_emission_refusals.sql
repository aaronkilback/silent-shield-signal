-- INC-ALERT-DELIVERY item 2: visible log for refused pageable-alert emissions (applied prod+staging).
create table if not exists public.alert_emission_refusals (
  id uuid primary key default gen_random_uuid(),
  tier text, reason text not null, client_id uuid, incident_id uuid, signal_id uuid, subject text,
  emitted_by text, created_at timestamptz not null default now());
create index if not exists idx_alert_emission_refusals_created on public.alert_emission_refusals(created_at desc);
create index if not exists idx_alert_emission_refusals_reason on public.alert_emission_refusals(reason);
alter table public.alert_emission_refusals enable row level security;
