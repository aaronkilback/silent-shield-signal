-- Retention for monitor_run_ledger (P1/silent-zero run substrate).
-- WINDOW = 90 days. Rationale: Variant A (regression) needs >=30d of aligned history to
-- distinguish a genuine producer from a bursty one; 90d = 30d baseline + recent detection
-- window + margin. It also lets Variant B accumulate a meaningful lifetime run-count for the
-- five orchestrator monitors whose ONLY run history is this ledger (~48/day → ~4,300 runs/90d,
-- ample to assert "never yielded"). 90d is the operator-stated floor; set exactly at the floor.
--
-- Operator ruling: REGISTERED + heartbeated (not an unregistered maintenance delete). The three
-- names are identical: cron jobname = heartbeat job_name = registry job_name =
-- 'purge-monitor-run-ledger-nightly'. Heartbeat is written by the cron SQL itself (a delete needs
-- no edge function). 04:37 UTC avoids collision with purge-ingest-decisions (04:17) / purge-ingest-shadow (04:23).
select cron.schedule(
  'purge-monitor-run-ledger-nightly',
  '37 4 * * *',
  $$
  with del as (
    delete from public.monitor_run_ledger
    where started_at < now() - interval '90 days'
    returning 1
  )
  insert into public.cron_heartbeat (job_name, started_at, completed_at, status, result_summary, duration_ms)
  select 'purge-monitor-run-ledger-nightly', now(), now(), 'completed',
         jsonb_build_object('rows_deleted', (select count(*) from del), 'retention_days', 90), 0;
  $$
);

insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
select 'purge-monitor-run-ledger-nightly', 1440,
       'Nightly 90-day retention purge of monitor_run_ledger (P1/silent-zero run substrate). Heartbeat written by the cron SQL; rows_deleted in result_summary.',
       false
where not exists (
  select 1 from public.cron_job_registry where job_name = 'purge-monitor-run-ledger-nightly'
);
