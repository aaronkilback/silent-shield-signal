-- Alert Delivery v2 (b): durable claiming, idempotency, sanitized observability, recipient
-- allowlist, atomic claim RPC, truthful health function, and the scheduler-secret vault reader.
-- Legacy alert rows/debt are NOT modified by this migration.

-- ── columns on alerts: claiming, idempotency, sanitized observability ──
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS delivery_key        text,            -- stable idempotency id
  ADD COLUMN IF NOT EXISTS claimed_by          text,            -- worker token
  ADD COLUMN IF NOT EXISTS claimed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_attempted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS error_class         text,
  ADD COLUMN IF NOT EXISTS error_message_safe  text,
  ADD COLUMN IF NOT EXISTS retryable           boolean,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

-- one delivery per stable key (idempotency); partial so legacy NULLs are unaffected
CREATE UNIQUE INDEX IF NOT EXISTS alerts_delivery_key_uq ON public.alerts (delivery_key) WHERE delivery_key IS NOT NULL;
-- efficient claim scan
CREATE INDEX IF NOT EXISTS alerts_email_claimable_idx ON public.alerts (created_at) WHERE channel = 'email' AND status IN ('pending','sending');

-- ── staging recipient allowlist (hard safety gate; seeded at provision time, not here) ──
CREATE TABLE IF NOT EXISTS public.alert_delivery_allowed_recipients (
  email      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_delivery_allowed_recipients ENABLE ROW LEVEL SECURITY;
-- service-role only (no anon/authenticated policy) — read by the function via service role.

-- ── atomic claim: pending OR lease-expired 'sending' (recovery), FOR UPDATE SKIP LOCKED ──
CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.alerts a
     SET status             = 'sending',
         claimed_by         = p_worker,
         claimed_at         = now(),
         lease_expires_at   = now() + make_interval(secs => p_lease_seconds),
         attempt_count      = a.attempt_count + 1,
         first_attempted_at = COALESCE(a.first_attempted_at, now()),
         last_attempted_at  = now(),
         delivery_key       = COALESCE(a.delivery_key, gen_random_uuid()::text),
         updated_at         = now()
   WHERE a.id IN (
     SELECT id FROM public.alerts
      WHERE channel = 'email'
        AND ( status = 'pending'
              OR (status = 'sending' AND lease_expires_at < now()) )  -- lease recovery
      ORDER BY created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING a.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_email_alerts(text,integer,integer) FROM anon, authenticated;

-- ── truthful, windowed delivery health (replaces the sent_at-NULL "undispatched" rule for
--    this path). Historical debt is excluded by the created_at window. ──
CREATE OR REPLACE FUNCTION public.alert_delivery_health(p_window interval DEFAULT interval '24 hours')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (SELECT * FROM public.alerts WHERE channel = 'email' AND created_at > now() - p_window)
  SELECT jsonb_build_object(
    'window', p_window::text,
    'pending_backlog',        (SELECT count(*) FROM w WHERE status = 'pending'),
    'pending_backlog_by_age', jsonb_build_object(
        'lt_30m', (SELECT count(*) FROM w WHERE status='pending' AND created_at >  now()-interval '30 min'),
        'ge_30m', (SELECT count(*) FROM w WHERE status='pending' AND created_at <= now()-interval '30 min')),
    'in_flight_sending',      (SELECT count(*) FROM w WHERE status = 'sending'),
    'attempts',               (SELECT count(*) FROM w WHERE status IN ('sent','delivered','failed')),
    'provider_accepted',      (SELECT count(*) FROM w WHERE status IN ('sent','delivered')),
    'confirmed_delivered',    (SELECT count(*) FROM w WHERE status = 'delivered'),
    'failed_by_class',        (SELECT COALESCE(jsonb_object_agg(COALESCE(error_class,'unknown'), c), '{}'::jsonb)
                                 FROM (SELECT error_class, count(*) c FROM w WHERE status='failed' GROUP BY error_class) x),
    'success_rate',           (SELECT CASE WHEN count(*) FILTER (WHERE status IN ('sent','delivered','failed')) = 0 THEN NULL
                                 ELSE round(count(*) FILTER (WHERE status IN ('sent','delivered'))::numeric
                                          / count(*) FILTER (WHERE status IN ('sent','delivered','failed')), 4) END FROM w),
    'retryable_failed',       (SELECT count(*) FROM w WHERE status='failed' AND retryable IS TRUE),
    'terminal_failed',        (SELECT count(*) FROM w WHERE status='failed' AND retryable IS NOT TRUE)
  );
$$;

-- ── scheduler-secret vault reader (mirrors get_service_role_key pattern). The pg_cron job
--    injects this into the x-alert-delivery-internal header. The SAME value must also be set
--    as the function env secret ALERT_DELIVERY_INTERNAL_SECRET (the handler compares against
--    env). Provisioned separately (operator), staging only. Returns NULL if unset -> cron sends
--    an empty header -> handler returns 401 (fail-closed). ──
CREATE OR REPLACE FUNCTION public.get_alert_delivery_internal_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'alert_delivery_internal_secret';
  RETURN k;
END;
$$;
REVOKE ALL ON FUNCTION public.get_alert_delivery_internal_secret() FROM anon, authenticated;
