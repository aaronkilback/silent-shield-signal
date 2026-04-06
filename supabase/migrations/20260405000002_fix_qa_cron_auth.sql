-- =============================================================================
-- Fix fortress-qa-6h cron job auth
-- fortress-qa-6h was missed by 20260405000001_secure_cron_tokens.sql
-- It still used current_setting('app.settings.service_role_key', true) which
-- returns NULL in pg_cron context, causing silent 401s on every run.
-- Reschedule using get_service_role_key() (vault-based) like all other jobs.
-- AC: AC-10.1
-- =============================================================================

SELECT cron.unschedule('fortress-qa-6h');

SELECT cron.schedule('fortress-qa-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-qa-agent',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);
