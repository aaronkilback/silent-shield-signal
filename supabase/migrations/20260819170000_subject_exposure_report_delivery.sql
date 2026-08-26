-- Report layer for Module #1 (subject exposure). Reuses the reports table (type='reputational_exposure',
-- issuable deny-by-default gate from WO-REPORT-PERSIST-01). Two additions:
--   1. reports.subject_entity_id — the scanned subject this exposure report is about (clean querying).
--   2. report_delivery_tokens — EXPIRING tokenized secure-link delivery (the intake's "secure portal").
--      Every delivery must populate reports.delivered_at/delivery_channel/recipient (empty across 278
--      reports — this is the first thing to populate them). RLS deny-by-default, service-role only.
alter table public.reports add column if not exists subject_entity_id uuid;

create table if not exists public.report_delivery_tokens (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  token text not null unique,
  recipient text not null,
  expires_at timestamptz not null,          -- the link EXPIRES (operator requirement)
  viewed_at timestamptz,                     -- first view (chain of custody)
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.report_delivery_tokens enable row level security;   -- RLS-at-Creation, service-role only
create index if not exists rdt_token_idx on public.report_delivery_tokens (token);
create index if not exists rdt_report_idx on public.report_delivery_tokens (report_id);
