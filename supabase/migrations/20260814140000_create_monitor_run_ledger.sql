-- P1 (WO-SILENT-ZERO-PROBE): durable, caller-stamped run record for router-dispatched
-- monitors. Closes the observability gap where orchestrator-invoked monitors
-- (weather/earthquakes/domains/linkedin/social) leave no durable trace — cron.job_run_details
-- is cron-only, cron_heartbeat is not written by them, edge logs are 24h.
-- Consumer: the silent-zero probe (Variant A/B). Written by osint-collector (service-role).
create table if not exists public.monitor_run_ledger (
  id           bigint generated always as identity primary key,
  monitor      text        not null,            -- delegated function name, e.g. monitor-weather
  action       text,                            -- osint-collector action key
  caller       text        not null default 'direct',  -- auto-orchestrator | direct | manual | ...
  status       text        not null,            -- 'ok' | 'failed'
  http_status  int,
  duration_ms  int,
  error        text,
  started_at   timestamptz not null default now()
);

-- RLS-at-Creation Standing Rule: enable RLS in the creating migration. Writers are
-- service-role (bypass RLS); no anon/authenticated reader → deny-by-default, no policy.
alter table public.monitor_run_ledger enable row level security;

create index if not exists monitor_run_ledger_monitor_started_idx
  on public.monitor_run_ledger (monitor, started_at desc);
create index if not exists monitor_run_ledger_started_idx
  on public.monitor_run_ledger (started_at desc);

comment on table public.monitor_run_ledger is
  'P1/WO-SILENT-ZERO-PROBE: caller-stamped per-invocation run record for osint-collector-dispatched monitors. Consumer: silent-zero probe. Service-role writes only; RLS on, no policy (deny-by-default).';
