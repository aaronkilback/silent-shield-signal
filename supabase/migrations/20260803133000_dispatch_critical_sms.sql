-- Critical-SMS alert channel (WO-AUDIT-FOLLOWUPS FU-2). Applied to prod via MCP; committed for parity.
-- Scope: category='security_posture' + severity='critical' + NEW (≤24h) + dedupe by fingerprint +
-- cap 3/day, overflow to the email digest. Reuses the MFA Twilio credentials. Function:
-- supabase/functions/dispatch-critical-sms. Cron every 15 min. Replay over last 30d = 0 pages.
create table if not exists public.sms_alert_log (
  id uuid primary key default gen_random_uuid(),
  fingerprint text,
  finding_title text,
  to_number_last4 text,        -- last 4 only — never the full number
  twilio_sid text,
  status text not null,        -- 'sent' | 'failed' | 'test' | 'skipped_cap'
  is_test boolean not null default false,
  sent_at timestamptz not null default now()
);
alter table public.sms_alert_log enable row level security;
create index if not exists sms_alert_log_fingerprint on public.sms_alert_log(fingerprint) where fingerprint is not null;
create index if not exists sms_alert_log_sent_at on public.sms_alert_log(sent_at);

select cron.schedule('dispatch-critical-sms-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/dispatch-critical-sms',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||public.get_service_role_key(),'apikey',public.get_service_role_key(),
      'x-fortress-internal', (select decrypted_secret from vault.decrypted_secrets where name='fortress_internal_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);
insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
values ('dispatch-critical-sms-15min', 15, 'Pages operator by SMS for NEW security_posture CRITICAL findings (dedupe by fingerprint, cap 3/day, overflow to email digest).', true)
on conflict (job_name) do nothing;
