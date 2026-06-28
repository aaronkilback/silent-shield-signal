-- Alert Delivery v2 (c): close the ZERO-MARGIN retry policy. The application auto-retry window must
-- be STRICTLY INSIDE the provider's (Resend) 24h Idempotency-Key retention, with margin, so that a
-- boundary retry can never land AFTER the provider key expires (which would send a duplicate).
--
-- SINGLE AUTHORITATIVE SOURCE: the cutoff lives ONLY in alert_delivery_idempotency_window_seconds().
-- The handler no longer passes a window argument; claim_pending_email_alerts reads the authoritative
-- value internally, so the handler CANNOT choose or drift the retry window. Migrations 000001/000002
-- are NOT modified. Idempotent + re-runnable.

-- 1) Authoritative cutoff: 79200s (22h) = Resend retention 86400s (24h) − 7200s (2h) margin.
--    The 2h margin dwarfs the worst-case sum of: cron jitter (<=15m), pg_net/scheduler delay
--    (minutes), function runtime (~2s), and our<->Resend clock skew (minutes). See the timing
--    analysis in the PR packet and the boundary proof in IDEMPOTENCY_MARGIN_TEST.sql.
CREATE OR REPLACE FUNCTION public.alert_delivery_idempotency_window_seconds()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 79200 $$;
REVOKE ALL ON FUNCTION public.alert_delivery_idempotency_window_seconds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_delivery_idempotency_window_seconds() TO service_role;

-- 2) Replace the claim RPC with a 3-arg signature (NO caller-supplied window). Drop the old 4-arg
--    form so no caller can pass a window at all. Behaviour is identical to 000002 EXCEPT the window
--    is read from the authoritative function above (was a caller param defaulting to 86400 = zero
--    margin). The stable delivery_key is preserved across reclaims (COALESCE), unchanged.
DROP FUNCTION IF EXISTS public.claim_pending_email_alerts(text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(
  p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_window_seconds integer := public.alert_delivery_idempotency_window_seconds();  -- AUTHORITATIVE cutoff
BEGIN
  -- Step 1: reconcile lease-expired 'sending' rows AT OR PAST the cutoff -> 'requires_reconciliation'
  --         (never auto-resent; provider outcome unknown). '<=' so age == cutoff reconciles.
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
     AND a.idempotency_anchor_at <= now() - make_interval(secs => c_window_seconds);

  -- Step 2: claim 'pending' OR lease-expired 'sending' STRICTLY INSIDE the cutoff ('>' so a row whose
  --         age == cutoff is NOT reclaimed; it was reconciled above). Resend dedups via Idempotency-Key.
  RETURN QUERY
  UPDATE public.alerts a
     SET status = 'sending',
         claimed_by = p_worker, claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = a.attempt_count + 1,
         first_attempted_at = COALESCE(a.first_attempted_at, now()),
         last_attempted_at = now(),
         delivery_key = COALESCE(a.delivery_key, gen_random_uuid()::text),   -- stable across reclaims
         idempotency_anchor_at = COALESCE(a.idempotency_anchor_at, now()),   -- persisted BEFORE provider contact
         updated_at = now()
   WHERE a.id IN (
     SELECT id FROM public.alerts
      WHERE channel = 'email'
        AND delivery_test_mode = true                -- staging: ONLY marked synthetic fixtures
        AND ( status = 'pending'
              OR ( status = 'sending' AND lease_expires_at < now()
                   AND idempotency_anchor_at > now() - make_interval(secs => c_window_seconds) ) )
      ORDER BY created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED )
   RETURNING a.*;
END;
$$;
-- Handler calls this via the service-role client; other API roles may not.
REVOKE ALL ON FUNCTION public.claim_pending_email_alerts(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_email_alerts(text,integer,integer) TO service_role;
