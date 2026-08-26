-- Restore the delivery_test_mode guard on the PROD delivery path.
--
-- Defect (found during INC alert-pipeline end-to-end testing): the prod claim RPC
-- claim_pending_email_alerts gates only on recipient membership (active+verified). It has no
-- delivery_test_mode exclusion, so a controlled test fixture alert (delivery_test_mode=true) with a
-- valid recipient would be claimed and SENT by the prod worker. Deactivating a fixture's recipient
-- neutralizes one fixture; it does not close the defect. This restores the invariant: TEST-MODE
-- ALERTS CANNOT ENTER THE PROD DELIVERY PATH REGARDLESS OF RECIPIENT STATE.
--
-- Only change vs the live definition: `and a2.delivery_test_mode is not true` added to the inner
-- claim SELECT. Everything else (idempotency-window reconciliation sweep, recipient-membership EXISTS,
-- lease/attempt bookkeeping, FOR UPDATE SKIP LOCKED, created_at ordering) is byte-for-byte preserved.
-- delivery_test_mode is NOT NULL DEFAULT false, so `is not true` == `= false` here; `is not true` is
-- used defensively so a NULL (should never occur) is treated as non-test (claimable), not silently
-- excluded.

CREATE OR REPLACE FUNCTION public.claim_pending_email_alerts(p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF alerts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c_window_seconds integer := public.alert_delivery_idempotency_window_seconds();
begin
  update public.alerts a
     set status='requires_reconciliation', error_class='idempotency_window_expired',
         error_message_safe='Provider outcome unknown after idempotency window; manual reconciliation required.',
         retryable=false, claimed_by=null, claimed_at=null, lease_expires_at=null, updated_at=now()
   where a.channel='email' and a.status='sending' and a.lease_expires_at < now()
     and a.idempotency_anchor_at is not null and a.idempotency_anchor_at <= now() - make_interval(secs => c_window_seconds);

  return query
  update public.alerts a
     set status='sending', claimed_by=p_worker, claimed_at=now(),
         lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
         attempt_count=a.attempt_count+1,
         first_attempted_at=coalesce(a.first_attempted_at, now()), last_attempted_at=now(),
         delivery_key=coalesce(a.delivery_key, gen_random_uuid()::text),
         idempotency_anchor_at=coalesce(a.idempotency_anchor_at, now()), updated_at=now()
   where a.id in (
     select a2.id from public.alerts a2
      where a2.channel='email' and a2.tier in ('notification','interruption')
        and a2.client_id is not null
        and a2.delivery_test_mode is not true          -- << restored guard: test-mode never enters prod delivery
        and exists (select 1 from public.client_alert_recipients r
                    where r.client_id = a2.client_id and r.active = true and r.verified_at is not null
                      and lower(r.email) = lower(a2.recipient))
        and ( a2.status='pending'
              or (a2.status='sending' and a2.lease_expires_at < now()
                  and a2.idempotency_anchor_at > now() - make_interval(secs => c_window_seconds)) )
      order by a2.created_at asc limit p_limit for update skip locked )
   returning a.*;
end; $function$;
