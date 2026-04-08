-- =============================================================================
-- WRAITH: Codebase snapshot cron
-- Runs at 05:45 UTC daily — 15 minutes before wraith-vuln-scan-nightly (06:00 UTC)
-- Populates codebase_snapshots so the vulnerability scanner has fresh source.
-- =============================================================================

SELECT cron.schedule(
  'wraith-snapshot-codebase-nightly',
  '45 5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/wraith-snapshot-codebase',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  )
  $$
);
