-- Alert Delivery v2 — PRODUCTION-ONLY pg_cron header cutover.
--
-- ⚠ PRODUCTION-ONLY. This migration hardcodes the PRODUCTION function URL
-- (project kpuqukppbmwebiptqmog). It SELF-GUARDS: on staging
-- (environment_config.environment_name = 'staging') it SKIPS with a NOTICE and schedules
-- nothing, so applying the repo migration set to staging can NOT create a cron that POSTs
-- cross-environment to prod. The staging cron is a separate, non-migration script:
-- functions/alert-delivery/STAGING_CRON.sql (manual, operator-gated, staging URL).
--
-- WHY: the legacy prod cron `alert-delivery-2min` drains the queue by POSTing
--   headers := Authorization: Bearer <get_service_role_key()>
-- The v2 hardened handler REJECTS that — a service-role/user bearer ALONE is never authority
-- (authorizeInternal validates ONLY the dedicated internal header). Without this cutover v2
-- would 401 every cron invocation. Hard ship-blocker for restoring authed transport.
--
-- CADENCE: every 15 minutes, staggered at :04/:19/:34/:49 — the v2 design reference cadence
-- (see STAGING_CRON.sql). NOTE: the legacy job's NAME 'alert-delivery-2min' was a MISNOMER —
-- its actual schedule was already '4,19,34,49 * * * *' (every 15 min). This preserves that
-- 15-min cadence. (Cadence is a tuning knob; tighten later if delivery latency demands it.)
--
-- SAFETY:
--   * Requires 20260628000002_b (get_alert_delivery_internal_secret) applied first (earlier
--     filename, additive).
--   * FAIL-CLOSED: if the vault secret 'alert_delivery_internal_secret' is unset,
--     get_alert_delivery_internal_secret() returns NULL -> cron sends an empty header ->
--     handler returns 401 (no delivery, nothing leaked). Safe to apply before the secret is set.
--   * v2 is EMAIL-ONLY + STAGING-gated (claim requires delivery_test_mode=true + allowlist),
--     so even once authed NO real client alert is delivered until the production recipient
--     model ships. This restores authed *transport* only.
--   * Idempotent: guarded unschedule of legacy + any prior v2 cron before schedule.

DO $do$
DECLARE
  v_env text;
BEGIN
  -- Prod-only self-guard: skip on staging so a cross-env prod-URL cron is never created there.
  IF to_regclass('public.environment_config') IS NOT NULL THEN
    SELECT environment_name INTO v_env FROM public.environment_config WHERE is_active = true LIMIT 1;
  END IF;
  IF v_env = 'staging' THEN
    RAISE NOTICE 'alert-delivery v2 prod cron: SKIPPED (environment=staging). PRODUCTION-ONLY migration; use STAGING_CRON.sql on staging.';
    RETURN;
  END IF;

  -- Retire the legacy service-role-bearer cron (rejected by v2). Guarded so re-apply is safe.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-delivery-2min') THEN
    PERFORM cron.unschedule('alert-delivery-2min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-delivery-v2-email') THEN
    PERFORM cron.unschedule('alert-delivery-v2-email');
  END IF;

  -- Schedule the v2 drain (every 15 min, staggered) with the dedicated internal-secret header.
  PERFORM cron.schedule('alert-delivery-v2-email', '4,19,34,49 * * * *', $cron$
    SELECT net.http_post(
      url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/alert-delivery',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   -- dedicated function-level authority; service-role is transport, not authority
                   'x-alert-delivery-internal', public.get_alert_delivery_internal_secret()
                 ),
      body    := '{}'::jsonb
    );
  $cron$);
END $do$;
