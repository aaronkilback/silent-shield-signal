-- Alert Delivery v2 — PRODUCTION pg_cron header cutover.
--
-- WHY: the legacy prod cron `alert-delivery-2min` drains the queue by POSTing
--   headers := Authorization: Bearer <get_service_role_key()>
-- The v2 hardened handler REJECTS that — a service-role/user bearer ALONE is never
-- authority (authorizeInternal validates ONLY the dedicated internal header). Without
-- this cutover, v2 would 401 every cron invocation. So this migration is a hard
-- ship-blocker for restoring authed transport.
--
-- WHAT: retire the legacy cron and schedule the v2 drain that presents the dedicated
-- internal-secret header `x-alert-delivery-internal` = get_alert_delivery_internal_secret().
--
-- SAFETY / ORDERING:
--   * Requires 20260628000002_b (get_alert_delivery_internal_secret) applied first — it is
--     (earlier filename, additive, applied before this one).
--   * FAIL-CLOSED: if the vault secret 'alert_delivery_internal_secret' is unset,
--     get_alert_delivery_internal_secret() returns NULL -> the cron sends an empty header ->
--     the handler returns 401 (no delivery, nothing leaked). Safe to apply BEFORE the vault
--     secret is provisioned; delivery simply stays denied until secret + env are set.
--   * The v2 handler is EMAIL-ONLY and STAGING-gated (claim requires delivery_test_mode=true
--     + recipient allowlist). Even once authed, NO real client alert is delivered until the
--     production recipient model ships (separate design brief). This cutover restores authed
--     *transport* only — it does not, by itself, resume client delivery.
--   * Idempotent: guarded unschedule of both the legacy and (any prior) v2 cron before schedule.

-- Retire the legacy service-role-bearer cron (rejected by v2). Guarded so re-apply is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-delivery-2min') THEN
    PERFORM cron.unschedule('alert-delivery-2min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-delivery-v2-email') THEN
    PERFORM cron.unschedule('alert-delivery-v2-email');
  END IF;
END $$;

-- Schedule the v2 drain with the dedicated internal-secret header (same cadence as legacy).
SELECT cron.schedule('alert-delivery-v2-email', '4,19,34,49 * * * *', $cron$
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
