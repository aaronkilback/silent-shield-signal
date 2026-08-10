-- WO-WILDFIRE-GENERALIZE: register the new client-agnostic emitter (parallel with old monitor-wildfires).
select cron.schedule('monitor-geo-wildfire-30min', '13,43 * * * *', $$
  select net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-geo-wildfire',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||public.get_service_role_key(),'apikey',public.get_service_role_key(),
      'x-fortress-internal', (select decrypted_secret from vault.decrypted_secrets where name='fortress_internal_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
insert into public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
values ('monitor-geo-wildfire-30min', 30, 'WO-WILDFIRE-GENERALIZE client-agnostic wildfire emitter (client_geo_assets/ST_DWithin; BCWS evac/fire + CWFIS-household; asset_type framing + item-1 household gate; output contract). Parallel with old monitor-wildfires until PECL parity.', true)
on conflict (job_name) do update set description=excluded.description, expected_interval_minutes=excluded.expected_interval_minutes, is_critical=excluded.is_critical;
