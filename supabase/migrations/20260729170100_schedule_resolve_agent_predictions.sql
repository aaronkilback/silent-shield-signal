-- Health-monitor triage: schedule Pillar-3 outcome resolver (function existed, phantom registry).
-- Heartbeat job_name is 'resolve-agent-predictions-daily' (registry -nightly was the mismatch).
select cron.unschedule('resolve-agent-predictions-daily') where exists (select 1 from cron.job where jobname='resolve-agent-predictions-daily');
select cron.schedule('resolve-agent-predictions-daily','0 8 * * *', $$
  select net.http_post(url:='https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/resolve-agent-predictions',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key()), body:='{}'::jsonb) $$);
insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
values ('resolve-agent-predictions-daily',1440,'Pillar-3 outcome-feedback resolver (agent_world_predictions). NOTE: input store currently EMPTY.',false)
on conflict (job_name) do update set expected_interval_minutes=1440, description=excluded.description;
