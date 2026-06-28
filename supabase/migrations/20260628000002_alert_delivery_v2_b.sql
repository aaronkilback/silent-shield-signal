-- Alert Delivery v2 (b): durable claiming, idempotency-window-aware reclaim/reconciliation,
-- sanitized observability, recipient allowlist, truthful health, and the locked-down
-- scheduler-secret vault reader. Legacy alert rows/debt are NOT modified by this migration.

-- ── columns: claiming, idempotency, sanitized observability ──
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS delivery_key          text,
  ADD COLUMN IF NOT EXISTS idempotency_anchor_at timestamptz,  -- first provider-contact time; anchors the ~24h window
  ADD COLUMN IF NOT EXISTS claimed_by            text,
  ADD COLUMN IF NOT EXISTS claimed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_attempted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS error_class           text,
  ADD COLUMN IF NOT EXISTS error_message_safe    text,
  ADD COLUMN IF NOT EXISTS retryable             boolean,
  ADD COLUMN IF NOT EXISTS provider_message_id   text,
  -- STAGING test-mode marker: ONLY deliberately-created synthetic test fixtures (set true) are
  -- ever claimed. Defaults false so existing/legacy/generated/real rows are ignored. This is a
  -- staging safety control, NOT the future production recipient model.
  ADD COLUMN IF NOT EXISTS delivery_test_mode    boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_delivery_key_uq ON public.alerts (delivery_key) WHERE delivery_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS alerts_email_claimable_idx ON public.alerts (created_at) WHERE channel = 'email' AND delivery_test_mode AND status IN ('pending','sending');

-- ── staging recipient allowlist (hard safety gate; seeded at provision time, not here) ──
CREATE TABLE IF NOT EXISTS public.alert_delivery_allowed_recipients (
  email      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_delivery_allowed_recipients ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy -> service-role only.

-- ── atomic claim + idempotency-window reconciliation ──
-- Step 1: lease-expired 'sending' rows PAST the idempotency window -> 'requires_reconciliation'
--         (never auto-resent; provider outcome unknown).
-- Step 2: claim 'pending' OR lease-expired 'sending' rows STILL WITHIN the window (resend is
--         provider-deduped via the Idempotency-Key). FOR UPDATE SKIP LOCKED for concurrency.
CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(
  p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120,
  p_idempotency_window_seconds integer DEFAULT 86400)
RETURNS SETOF public.alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Step 1: reconcile (no resend)
  UPDATE public.alerts a
     SET status = 'requires_reconciliation',
         error_class = 'idempotency_window_expired',
         error_message_safe = 'Provider outcome unknown after idempotency window; manual reconciliation required.',
         retryable = false,
         claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL,
         updated_at = now()
   WHERE a.channel = 'email' AND a.status = 'sending'
     AND a.delivery_test_mode = true                 -- staging: only marked test fixtures
     AND a.lease_expires_at < now()
     AND a.idempotency_anchor_at IS NOT NULL
     AND a.idempotency_anchor_at <= now() - make_interval(secs => p_idempotency_window_seconds);

  -- Step 2: claim
  RETURN QUERY
  UPDATE public.alerts a
     SET status = 'sending',
         claimed_by = p_worker, claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = a.attempt_count + 1,
         first_attempted_at = COALESCE(a.first_attempted_at, now()),
         last_attempted_at = now(),
         delivery_key = COALESCE(a.delivery_key, gen_random_uuid()::text),
         idempotency_anchor_at = COALESCE(a.idempotency_anchor_at, now()),  -- persisted BEFORE provider contact
         updated_at = now()
   WHERE a.id IN (
     SELECT id FROM public.alerts
      WHERE channel = 'email'
        AND delivery_test_mode = true                -- staging: ONLY marked synthetic fixtures
        AND ( status = 'pending'
              OR ( status = 'sending' AND lease_expires_at < now()
                   AND idempotency_anchor_at > now() - make_interval(secs => p_idempotency_window_seconds) ) )
      ORDER BY created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED )
   RETURNING a.*;
END;
$$;
-- Handler calls this via the service-role client; other API roles may not.
REVOKE ALL ON FUNCTION public.claim_pending_email_alerts(text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_email_alerts(text,integer,integer,integer) TO service_role;

-- ── truthful, windowed delivery health (replaces the sent_at-NULL "undispatched" rule).
--    Historical debt excluded by the window. Surfaces reconciliation + delivered separately. ──
CREATE OR REPLACE FUNCTION public.alert_delivery_health(p_window interval DEFAULT interval '24 hours')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH w AS (SELECT * FROM public.alerts WHERE channel = 'email' AND created_at > now() - p_window)
  SELECT jsonb_build_object(
    'window', p_window::text,
    'pending_backlog',        (SELECT count(*) FROM w WHERE status = 'pending'),
    'pending_backlog_by_age', jsonb_build_object(
        'lt_30m', (SELECT count(*) FROM w WHERE status='pending' AND created_at >  now()-interval '30 min'),
        'ge_30m', (SELECT count(*) FROM w WHERE status='pending' AND created_at <= now()-interval '30 min')),
    'in_flight_sending',      (SELECT count(*) FROM w WHERE status = 'sending'),
    'requires_reconciliation',(SELECT count(*) FROM w WHERE status = 'requires_reconciliation'),
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
REVOKE ALL ON FUNCTION public.alert_delivery_health(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_delivery_health(interval) TO service_role;

-- ── scheduler-secret vault reader (called ONLY by the pg_cron job owner, never via PostgREST).
--    SECURITY DEFINER, empty search_path, fully-qualified vault ref. The handler does NOT call
--    this (it reads the Edge Function env secret). The SAME value is provisioned separately as
--    both the Edge Function secret ALERT_DELIVERY_INTERNAL_SECRET and the vault secret below.
--    NEVER printed/logged/committed. Returns NULL if unset -> cron sends empty header -> 401. ──
CREATE OR REPLACE FUNCTION public.get_alert_delivery_internal_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'alert_delivery_internal_secret';
  RETURN k;
END;
$$;
-- Hard custody isolation: not callable by ANY API-exposed role; only the function owner
-- (the role the pg_cron job runs as) can invoke it. Not reachable through PostgREST/RPC.
REVOKE ALL ON FUNCTION public.get_alert_delivery_internal_secret() FROM PUBLIC, anon, authenticated, service_role;
