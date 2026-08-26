-- WO-WRAITH-VULN-SCAN-DEAD-01 (Option A): the wraith-vuln-scan-nightly cron now authenticates to
-- the operator-only run_vulnerability_scan via the canonical internal-caller secret
-- (x-fortress-internal, sourced from vault.decrypted_secrets), exactly as source-discovery-weekly.
-- The prior service-role-key auth could never satisfy wraith's gate (task #111 key drift: the
-- gate exact-matches env SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_JWT, which no DB-accessible key
-- equals — the GUC app.settings.service_role_key was also unset). Layer-1 URL fix retained.
-- Applied to prod 2026-08-02 via single-file apply_migration.
SELECT cron.unschedule('wraith-vuln-scan-nightly');
SELECT cron.schedule(
  'wraith-vuln-scan-nightly',
  '0 6 * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/wraith-security-advisor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key(),
      'x-fortress-internal', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortress_internal_secret')
    ),
    body := '{"action": "run_vulnerability_scan"}'::jsonb
  );
  $CRON$
);
