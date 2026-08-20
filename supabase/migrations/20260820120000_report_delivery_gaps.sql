-- Delivery-link gaps (operator 2026-08-20): per-token revocation, per-open access log with enforced
-- 90-day IP retention, expiry banner (done in the view fn). All RLS deny-by-default, service-role only.

-- (5) Per-token revocation — kill ONE live link (finer than flipping reports.issuable=false, which kills all).
alter table public.report_delivery_tokens add column if not exists revoked_at timestamptz;
alter table public.report_delivery_tokens add column if not exists revoked_by uuid;
alter table public.report_delivery_tokens add column if not exists revoked_reason text;

-- (4) Access log — one row per open. Captures IP (PERSONAL DATA about the client on an unauthenticated
-- route) + user-agent, so "who opened it and when" is answerable across multiple opens. 90-day retention.
create table if not exists public.report_access_log (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  token_id uuid,
  opened_at timestamptz not null default now(),
  ip text,
  user_agent text
);
alter table public.report_access_log enable row level security;
create index if not exists ral_report_idx on public.report_access_log (report_id, opened_at desc);
create index if not exists ral_opened_idx on public.report_access_log (opened_at);

-- Retention ENFORCEMENT (like the scan-intake purges): a nightly cron deletes IP rows >90 days and
-- heartbeats. SECURITY DEFINER, not anon/authenticated-executable.
create or replace function public.purge_report_access_log() returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.report_access_log where opened_at < now() - interval '90 days';
  get diagnostics n = row_count;
  insert into public.cron_heartbeat (job_name, started_at, completed_at, status, result_summary, duration_ms)
    values ('purge-report-access-log-90d', now(), now(), 'completed', jsonb_build_object('deleted', n, 'retention_days', 90), 0);
end $$;
revoke all on function public.purge_report_access_log() from anon, authenticated;

do $$ begin perform cron.unschedule('purge-report-access-log-90d'); exception when others then null; end $$;
select cron.schedule('purge-report-access-log-90d', '17 3 * * *', $$select public.purge_report_access_log();$$);

insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
  values ('purge-report-access-log-90d', 1440, 'Delete report_access_log rows older than 90 days — client-IP retention on the unauthenticated report-view route.', false)
  on conflict (job_name) do nothing;
