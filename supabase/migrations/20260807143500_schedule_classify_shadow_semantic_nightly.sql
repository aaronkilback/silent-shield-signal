-- WO-GATE-PHASE3 slice 4b: register the nightly semantic classifier as a DECLARED cron expectation
-- (Registry-is-a-Promise), NOT a hook. Nightly 09:15 UTC over the day's ingest_shadow no_client_match
-- rows. job_name is identical across cron.job / cron_heartbeat / cron_job_registry.
select cron.schedule('classify-shadow-semantic-nightly', '15 9 * * *', $$
  select net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/classify-shadow-semantic-nightly',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||public.get_service_role_key(),'apikey',public.get_service_role_key(),
      'x-fortress-internal', (select decrypted_secret from vault.decrypted_secrets where name='fortress_internal_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 300000);
$$);

insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
values ('classify-shadow-semantic-nightly', 1440,
  'WO-GATE-PHASE3 4b: nightly LLM multi-class semantic classifier over ingest_shadow no_client_match rows (recall-opportunity set). Write-isolated (ingest_shadow only). Output assertion: candidates present but 0 classified = failHeartbeat. Hard caps: 2000 items/run, $1.00/run spend ceiling; measured spend logged per run.',
  false)
on conflict (job_name) do update set
  expected_interval_minutes = excluded.expected_interval_minutes,
  description = excluded.description,
  is_critical = excluded.is_critical;
