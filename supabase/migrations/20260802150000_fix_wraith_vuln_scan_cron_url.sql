-- WO-WRAITH-VULN-SCAN-DEAD-01 (layer 1): the scheduled net.http_post URL literal was split
-- across a line with injected whitespace ('.../wraith-secur\n  ity-advisor'), producing
-- "URL using bad/illegal format or missing URL" and 114/114 failed runs since 2026-04-11.
-- Reschedule with a clean single-line URL (mirrors the working wraith-snapshot-codebase cron).
--
-- NOTE: this fixes ONLY the URL. A second blocker remains (layer 2): wraith-security-advisor's
-- auth gate accepts service-role only when the Bearer == env SUPABASE_SERVICE_ROLE_KEY /
-- SERVICE_ROLE_JWT, but the cron sends current_setting('app.settings.service_role_key'), which
-- does not match (task #111 key drift). A manual invoke after this fix returned HTTP 401.
-- The scan still produces nothing until the key alignment is resolved (operator decision).
-- Applied to prod 2026-08-02 via single-file apply_migration.
SELECT cron.unschedule('wraith-vuln-scan-nightly');
SELECT cron.schedule(
  'wraith-vuln-scan-nightly',
  '0 6 * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/wraith-security-advisor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"action": "run_vulnerability_scan"}'::jsonb
  )
  $CRON$
);
