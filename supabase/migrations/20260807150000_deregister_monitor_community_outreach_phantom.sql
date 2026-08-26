-- Operator ruling 2026-08-07: DE-REGISTER the monitor-community-outreach phantom. It has never had an
-- active prod cron, so it has never run — no evidence it earns a slot. De-register rather than
-- schedule: adding a cron to a function nobody has missed is how phantoms become real spend. If
-- community-outreach monitoring matters later, re-register deliberately WITH an output contract.
-- Recorded as RETIRED (not silenced): registry row deleted here + heartbeat allowlisted in
-- validate-cron-alignment.mjs. Function file kept as inventory (same as monitor-twitter/social).
delete from public.cron_job_registry where job_name = 'monitor-community-outreach-hourly';

-- best-effort: drop any stale cron.job of that name (none expected — that's why it's a phantom)
do $$ begin
  perform cron.unschedule('monitor-community-outreach-hourly');
exception when others then null; end $$;
