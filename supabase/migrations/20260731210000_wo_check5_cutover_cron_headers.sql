-- WO-CHECK5-BURNDOWN-01 cutover (descoped) — add the x-fortress-internal header to the 5 in-scope crons.
--
-- Each cron's existing url / body / service-role-auth pattern is preserved VERBATIM (captured live from
-- cron.job jobids 98/126/132/191/204 on 2026-07-31 — note the 3 different service-key sources: get_service_role_key(),
-- current_setting('app.settings.service_role_key'), and vault 'service_role_key'). ONLY the x-fortress-internal
-- header is added, sourced from vault.decrypted_secrets name 'fortress_internal_secret' at RUN time (picks up
-- rotations; never hardcoded — digest-verified identical to the function-secret 2026-07-31).
--
-- SEQUENCING: apply this migration BEFORE deploying the gated functions (callers must send the header before the
-- gate requires it; the old ungated functions ignore the extra header — no header-less window).
-- ROLLBACK: if a cron 401s post-deploy, re-run the original command (roll back THIS caller's wiring, not the gate).
-- knowledge-synthesizer's cron is intentionally EXCLUDED (deferred — WO-CUTOVER-KSYNTH-01).

-- jobid 98 — auto-enrich-entities-nightly
select cron.unschedule('auto-enrich-entities-nightly');
select cron.schedule('auto-enrich-entities-nightly', '0 3 * * *', $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-enrich-entities',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key(), 'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')),
    body    := '{"batch_mode": true, "limit": 20, "auto_apply": true, "min_confidence": 0.7}'::jsonb
  );
$cron$);

-- jobid 126 — source-discovery-weekly
select cron.unschedule('source-discovery-weekly');
select cron.schedule('source-discovery-weekly', '0 3 * * 0', $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-source-discovery',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key(), 'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')),
    body    := '{}'::jsonb
  );
$cron$);

-- jobid 132 — fortress-detect-patterns-6h
select cron.unschedule('fortress-detect-patterns-6h');
select cron.schedule('fortress-detect-patterns-6h', '15 */6 * * *', $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/detect-threat-patterns',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json',
      'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')
    ),
    body := '{}'::jsonb
  )
$cron$);

-- jobid 191 — monitor-court-registry-4h
select cron.unschedule('monitor-court-registry-4h');
select cron.schedule('monitor-court-registry-4h', '28 */4 * * *', $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-court-registry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')
    ),
    body := '{}'::jsonb
  )
$cron$);

-- jobid 204 — auto-summarize-incidents-nightly
select cron.unschedule('auto-summarize-incidents-nightly');
select cron.schedule('auto-summarize-incidents-nightly', '30 3 * * *', $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-summarize-incident',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')
    ),
    body    := '{"batch_mode": true}'::jsonb
  );
$cron$);
