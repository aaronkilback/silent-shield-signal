-- Schedule the two Tier-3 cron jobs deployed 2026-04-29.
-- Apply via: https://supabase.com/dashboard/project/kpuqukppbmwebiptqmog/sql/new

-- 1. Predictive event extraction every 6h (offset 25 min so it doesn't
--    collide with the entity narratives job at :15).
SELECT cron.schedule(
  'extract-predicted-events-6h',
  '25 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/extract-predicted-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- 2. Verify
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN (
  'extract-predicted-events-6h',
  'synthesize-entity-narratives-6h'
) ORDER BY jobname;
