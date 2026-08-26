-- WO-REPORT-PERSIST-01 + WO-GROUNDING-01 item 0b
-- Deny-by-default issuance gate + issuance tracking + durable claim manifest.
-- Applied to prod via single-file apply_migration 2026-07-30 (migration-apply prohibition: no db push).

alter table public.reports
  add column if not exists issuable boolean not null default false,
  add column if not exists rendered_persisted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_channel text,
  add column if not exists recipient text,
  add column if not exists exported_by uuid;

comment on column public.reports.issuable is
  'WO-GROUNDING-01 item 0b: deny-by-default. A report may NOT be issued/exported/delivered to a client until grounding verification flips this true. Every pre-grounding report (all 154 existing) remains false.';
comment on column public.reports.delivered_at is
  'WO-REPORT-PERSIST-01: set when the report is actually sent to a client. NULL = generated-only. Generated and sent are now distinguishable in the DB.';

create table if not exists public.report_claim_manifest (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  section text not null,
  assertion text not null,
  cited_signal_number text,      -- as rendered in prose (e.g. SIG-2026-027390); null = uncited assertion
  bound_signal_id uuid,          -- populated once binding-at-derivation ships (WO-GROUNDING-01)
  citation_line text,
  resolver_verdict text,         -- citable | <reason code> | non_citable
  supports_claim boolean,        -- grounding verdict; NULL until graded
  client_id uuid,
  tenant_id uuid,
  created_at timestamptz not null default now()
);

-- RLS-at-Creation Standing Rule: enabled in the same migration. Service-role writers bypass;
-- deny-by-default for anon/authenticated (internal bookkeeping, no non-service reader yet).
alter table public.report_claim_manifest enable row level security;

create index if not exists idx_report_claim_manifest_report on public.report_claim_manifest(report_id);

comment on table public.report_claim_manifest is
  'WO-REPORT-PERSIST-01: durable per-assertion manifest for every generated report. Named consumers: system-watchdog grounding probe + the issuance gate. Deny-by-default RLS.';
