-- #76 (C-1) — tighten the email claim gate to DELIVERY tiers only.
-- Was: `tier IS NOT NULL AND tier <> 'log'` (admitted 'finding' too).
-- Now: `tier IN ('notification','interruption')`. FINDING is operator-pull per the four-tier
-- Protect-Attention doctrine and must NEVER email — encode it in the gate now, not when tripped.
-- (Doctrine adaptation, ledger-noted: email stands in as the NOTIFICATION transport until Slack/Teams
--  ship; INTERRUPTION's SMS/oncall transports are deferred per AV.3.)
CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(
  p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF alerts
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  c_window_seconds integer := public.alert_delivery_idempotency_window_seconds();
BEGIN
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
        -- DELIVERY tiers only. log=awareness, finding=operator-pull -> never emailed.
        AND a2.tier IN ('notification', 'interruption')
        AND a2.incident_id IS NOT NULL
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
