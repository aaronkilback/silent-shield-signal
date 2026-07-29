-- Health-monitor triage 2026-07-29: de-register named phantoms + registry_phantom_check RPC.
-- Applied prod (+ staging for the RPC) via MCP. See CLAUDE.md Registry-is-a-Promise standing rule.
delete from public.cron_job_registry where job_name in ('monitor-threat-intel','monitor-twitter-6h','monitor-community-outreach-hourly','resolve-agent-predictions-nightly');
select cron.unschedule('monitor-community-outreach-hourly') where exists (select 1 from cron.job where jobname='monitor-community-outreach-hourly');
update public.cron_job_registry set expected_interval_minutes=360 where job_name='monitor-news-google-hourly';
-- drop legacy bare-name registry duplicates superseded by a suffixed cron variant
delete from public.cron_job_registry r where not exists (select 1 from cron.job j where j.jobname=r.job_name)
  and exists (select 1 from cron.job j2 where j2.jobname like r.job_name || '-%');
create or replace function public.registry_phantom_check()
returns table(job_name text, has_cron boolean, ever_succeeded boolean)
language sql security definer stable set search_path = public, cron as $$
  select r.job_name,
    exists (select 1 from cron.job j where j.jobname = r.job_name),
    exists (select 1 from public.cron_heartbeat h where h.job_name = r.job_name and h.status in ('succeeded','completed'))
  from public.cron_job_registry r order by r.job_name;
$$;
