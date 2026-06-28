-- ============================================================================
-- Alert Delivery v2 — STAGING-ONLY pg_cron schedule.
-- DO NOT auto-apply. This is intentionally NOT a migration file so it cannot run
-- via the normal migration path. Apply manually on STAGING ONLY, and only AFTER:
--   1. the v2 handler is deployed to staging, AND
--   2. ALERT_DELIVERY_INTERNAL_SECRET is provisioned BOTH as the function env secret
--      AND as the vault secret 'alert_delivery_internal_secret' (same value), AND
--   3. operator approval.
-- Cadence mirrors the production reference cadence (every 15 min, staggered). It does
-- NOT create or modify any PRODUCTION cron. URL targets the STAGING project only.
-- ============================================================================

SELECT cron.schedule('alert-delivery-v2-email-staging', '4,19,34,49 * * * *', $$
  SELECT net.http_post(
    url     := 'https://lkvyrvuakzguszbpwnfz.supabase.co/functions/v1/alert-delivery',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 -- dedicated function-level authority; service-role is only transport, not authority
                 'x-alert-delivery-internal', public.get_alert_delivery_internal_secret()
               ),
    body    := '{}'::jsonb
  );
$$);

-- To remove: SELECT cron.unschedule('alert-delivery-v2-email-staging');
