-- #71 B (claim-time) — swap the claim gate from `delivery_test_mode=true` to
-- per-client recipient-membership, with tier and clientless exclusions EXPLICIT.
--
-- Delivers nothing until #71 A's client_alert_recipients has an active+verified row
-- (empty table => the EXISTS matches zero alerts => functionally contained, like the old
-- test-mode gate). #72 turns the key per client by adding verified recipients.
--
-- Semantics preserved from the prior version: idempotency cutoff owned by the DB, lease,
-- attempt tracking, delivery_key, FOR UPDATE SKIP LOCKED, created_at ordering.
CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(
  p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF alerts
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  c_window_seconds integer := public.alert_delivery_idempotency_window_seconds();  -- AUTHORITATIVE cutoff
BEGIN
  -- Reconciliation sweep: ANY stuck 'sending' email alert past the idempotency window.
  -- The `delivery_test_mode` gate is DROPPED here deliberately: a recipient deactivated
  -- mid-flight must NOT strand an already-claimed row out of reconciliation.
  UPDATE public.alerts a
     SET status = 'requires_reconciliation',
         error_class = 'idempotency_window_expired',
         error_message_safe = 'Provider outcome unknown after idempotency window; manual reconciliation required.',
         retryable = false,
         claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL,
         updated_at = now()
   WHERE a.channel = 'email' AND a.status = 'sending'
     AND a.lease_expires_at < now()
     AND a.idempotency_anchor_at IS NOT NULL
     AND a.idempotency_anchor_at <= now() - make_interval(secs => c_window_seconds);

  RETURN QUERY
  UPDATE public.alerts a
     SET status = 'sending',
         claimed_by = p_worker, claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = a.attempt_count + 1,
         first_attempted_at = COALESCE(a.first_attempted_at, now()),
         last_attempted_at = now(),
         delivery_key = COALESCE(a.delivery_key, gen_random_uuid()::text),
         idempotency_anchor_at = COALESCE(a.idempotency_anchor_at, now()),
         updated_at = now()
   WHERE a.id IN (
     SELECT a2.id FROM public.alerts a2
      WHERE a2.channel = 'email'
        -- EXPLICIT tier gate: only KNOWN delivery tiers. NULL tier is EXCLUDED DELIBERATELY
        -- (an untyped alert is not a claim target); 'log' is never delivered.
        AND a2.tier IS NOT NULL AND a2.tier <> 'log'
        -- EXPLICIT clientless exclusion (defense): must resolve to a client via its incident.
        AND a2.incident_id IS NOT NULL
        -- Per-client verified allowlist: the alert's client must have an ACTIVE + VERIFIED
        -- recipient row whose email matches the alert recipient (case-insensitive).
        AND EXISTS (
              SELECT 1
                FROM public.incidents i
                JOIN public.client_alert_recipients r ON r.client_id = i.client_id
               WHERE i.id = a2.incident_id
                 AND r.active = true AND r.verified_at IS NOT NULL
                 AND lower(r.email) = lower(a2.recipient))
        AND ( a2.status = 'pending'
              OR ( a2.status = 'sending' AND a2.lease_expires_at < now()
                   AND a2.idempotency_anchor_at > now() - make_interval(secs => c_window_seconds) ) )
      ORDER BY a2.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED )
   RETURNING a.*;
END;
$function$;

-- Nit (from #71 A review): pin search_path on the touch trigger fn to house style.
CREATE OR REPLACE FUNCTION public.tg_client_alert_recipients_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
