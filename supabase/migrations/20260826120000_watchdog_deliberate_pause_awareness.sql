-- Teach the watchdog to tell a DELIBERATE cron pause from a BROKEN pipeline.
--
-- Problem: the INC-ALERT-DELIVERY probe fires CRITICAL when a pageable alert sits >2h with a verified
-- recipient. When the operator deliberately pauses alert-delivery-v2-email (cron.alter_job active:=false),
-- held alerts are EXPECTED — but the probe reported a false CRITICAL every morning.
--
-- Ground-truth signal: a runtime failure leaves the cron active=true (it just errors); only an explicit
-- cron.alter_job(active:=false) disables it. So active=false == deliberate pause. Keying the downgrade on
-- cron.job.active means re-enabling the cron AUTOMATICALLY restores the CRITICAL alarm — a stale note can
-- never silence a real outage. The reason note is for the morning message only, not for the decision.
--
-- The watchdog edge function cannot read the `cron` schema via PostgREST, so it needs a SECURITY DEFINER
-- RPC. Returns NULL when the job does not exist (distinct from false=paused) so a MISSING delivery cron is
-- NOT mistaken for a benign pause.

create or replace function public.is_cron_job_active(p_jobname text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  select active from cron.job where jobname = p_jobname limit 1;
$$;

revoke all on function public.is_cron_job_active(text) from public, anon, authenticated;
grant execute on function public.is_cron_job_active(text) to service_role;

-- Operator-recorded reason for a deliberate pause. Consumer: system-watchdog (turns the false CRITICAL
-- into an informational "paused — held" finding, with this reason in the message).
create table if not exists public.cron_pause_notes (
  job_name  text primary key,
  reason    text not null,
  paused_by text,
  paused_at timestamptz not null default now()
);

-- RLS-at-Creation: closed by default. Service-role (watchdog / operator tooling) bypasses RLS; no
-- anon/authenticated access is needed, so no policy is added.
alter table public.cron_pause_notes enable row level security;

comment on table public.cron_pause_notes is
  'Operator-recorded reason a cron is deliberately paused. Consumed by system-watchdog to report a paused delivery cron as informational (held/expected) instead of a false CRITICAL. The pause DECISION is ground-truthed on cron.job.active; this table only supplies the human reason.';

insert into public.cron_pause_notes (job_name, reason, paused_by)
values ('alert-delivery-v2-email',
        'Operator deliberately paused pending alert-pipeline sign-off — sends stay OFF until the operator is satisfied (INC alert-pipeline).',
        'operator')
on conflict (job_name) do nothing;
