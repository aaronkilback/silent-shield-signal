-- Alert Delivery v2 (c): close the ZERO-MARGIN retry policy. The application auto-retry window must
-- be STRICTLY INSIDE the provider's (Resend) 24h Idempotency-Key retention, with margin, so that a
-- boundary retry can never land AFTER the provider key expires (which would send a duplicate).
--
-- SINGLE AUTHORITATIVE SOURCE: the cutoff lives ONLY in alert_delivery_idempotency_window_seconds().
-- The handler no longer passes a window argument; claim_pending_email_alerts reads the authoritative
-- value internally, so the handler CANNOT choose or drift the retry window. Migrations 000001/000002
-- are NOT modified. Only the caller-supplied window is eliminated; the claim/reconcile SELECTION
-- predicates and SET lists are otherwise BYTE-FOR-BYTE the same as 000002 (window source aside).
--
-- FAIL-CLOSED / ONE-SHOT: this migration verifies the EXACT expected pre-state, does an EXACT guarded
-- drop of the old 4-arg overload, and asserts the post-state. It is intentionally NOT idempotent —
-- re-running after success ABORTS (pre-state no longer holds). Any drift aborts the whole transaction.

-- ── 0. PRE-STATE GUARD (abort on any drift) ─────────────────────────────────────────────────────
DO $guard$
DECLARE
  v4   oid := to_regprocedure('public.claim_pending_email_alerts(text,integer,integer,integer)');
  v3   oid := to_regprocedure('public.claim_pending_email_alerts(text,integer,integer)');
  vcut oid := to_regprocedure('public.alert_delivery_idempotency_window_seconds()');
  v4_secdef boolean; v4_search boolean; v4_owner name; bad_grantees text;
BEGIN
  -- (a) expected 4-arg overload MUST exist: SECURITY DEFINER, a locked search_path, owner postgres
  IF v4 IS NULL THEN
    RAISE EXCEPTION 'ABORT (pre-state): expected 4-arg claim_pending_email_alerts(text,integer,integer,integer) not found';
  END IF;
  SELECT p.prosecdef,
         EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%'),
         pg_get_userbyid(p.proowner)
    INTO v4_secdef, v4_search, v4_owner FROM pg_proc p WHERE p.oid = v4;
  IF NOT v4_secdef OR NOT v4_search OR v4_owner <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT (pre-state): 4-arg attributes unexpected (secdef=%, search_path_set=%, owner=%)',
      v4_secdef, v4_search, v4_owner;
  END IF;
  -- (b) 4-arg EXECUTE ACL MUST be exactly {postgres, service_role} — no PUBLIC, no other role
  SELECT string_agg(DISTINCT ae.grantee::regrole::text, ',')
    INTO bad_grantees
    FROM pg_proc p, aclexplode(p.proacl) ae
   WHERE p.oid = v4 AND ae.privilege_type = 'EXECUTE'
     AND (ae.grantee = 0 OR ae.grantee::regrole::text NOT IN ('postgres','service_role'));
  IF bad_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT (pre-state): 4-arg has unexpected EXECUTE grantees: %', bad_grantees;
  END IF;
  -- (c) the NEW objects MUST be absent
  IF v3   IS NOT NULL THEN RAISE EXCEPTION 'ABORT (pre-state): 3-arg claim RPC already exists'; END IF;
  IF vcut IS NOT NULL THEN RAISE EXCEPTION 'ABORT (pre-state): cutoff function already exists'; END IF;
END $guard$;

-- ── 1. authoritative cutoff (the ONLY place the value lives) ─────────────────────────────────────
--     79200s (22h) = Resend retention 86400s (24h) − 7200s (2h) margin. Worst-case interval from the
--     claim-time eligibility decision to the awaited provider request is bounded by the worker
--     wall-clock ceiling (<=400s) + clock skew (<=300s) ~= <12 min, far under the 2h margin.
CREATE FUNCTION public.alert_delivery_idempotency_window_seconds()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 79200 $$;
REVOKE ALL ON FUNCTION public.alert_delivery_idempotency_window_seconds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_delivery_idempotency_window_seconds() TO service_role;

-- ── 2. new 3-arg claim RPC (NO caller window; reads the authoritative cutoff internally) ─────────
--     Identical to 000002 EXCEPT: signature drops p_idempotency_window_seconds, and every
--     `make_interval(secs => p_idempotency_window_seconds)` becomes `make_interval(secs => c_window_seconds)`
--     where c_window_seconds := the authoritative function. SELECTION predicates + SET lists unchanged.
CREATE FUNCTION public.claim_pending_email_alerts(
  p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  c_window_seconds integer := public.alert_delivery_idempotency_window_seconds();  -- AUTHORITATIVE cutoff
BEGIN
  -- Step 1: reconcile lease-expired 'sending' rows AT OR PAST the cutoff -> 'requires_reconciliation'.
  UPDATE public.alerts a
     SET status = 'requires_reconciliation',
         error_class = 'idempotency_window_expired',
         error_message_safe = 'Provider outcome unknown after idempotency window; manual reconciliation required.',
         retryable = false,
         claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL,
         updated_at = now()
   WHERE a.channel = 'email' AND a.status = 'sending'
     AND a.delivery_test_mode = true
     AND a.lease_expires_at < now()
     AND a.idempotency_anchor_at IS NOT NULL
     AND a.idempotency_anchor_at <= now() - make_interval(secs => c_window_seconds);

  -- Step 2: claim 'pending' OR lease-expired 'sending' STRICTLY INSIDE the cutoff.
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
     SELECT id FROM public.alerts
      WHERE channel = 'email'
        AND delivery_test_mode = true
        AND ( status = 'pending'
              OR ( status = 'sending' AND lease_expires_at < now()
                   AND idempotency_anchor_at > now() - make_interval(secs => c_window_seconds) ) )
      ORDER BY created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED )
   RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pending_email_alerts(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_email_alerts(text,integer,integer) TO service_role;

-- ── 3. EXACT guarded drop of the verified 4-arg overload (pre-state confirmed in step 0) ─────────
DROP FUNCTION public.claim_pending_email_alerts(text, integer, integer, integer);

-- ── 4. POST-STATE ASSERT (abort if replacement did not land exactly) ────────────────────────────
DO $post$
DECLARE
  v3   oid := to_regprocedure('public.claim_pending_email_alerts(text,integer,integer)');
  v4   oid := to_regprocedure('public.claim_pending_email_alerts(text,integer,integer,integer)');
  vcut oid := to_regprocedure('public.alert_delivery_idempotency_window_seconds()');
  v3_secdef boolean; v3_search boolean; v3_owner name; bad_grantees text;
BEGIN
  IF v3 IS NULL THEN RAISE EXCEPTION 'ABORT (post-state): 3-arg RPC missing after replace'; END IF;
  IF v4 IS NOT NULL THEN RAISE EXCEPTION 'ABORT (post-state): 4-arg overload still present'; END IF;
  IF vcut IS NULL THEN RAISE EXCEPTION 'ABORT (post-state): cutoff function missing'; END IF;
  SELECT p.prosecdef,
         EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%'),
         pg_get_userbyid(p.proowner)
    INTO v3_secdef, v3_search, v3_owner FROM pg_proc p WHERE p.oid = v3;
  IF NOT v3_secdef OR NOT v3_search OR v3_owner <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT (post-state): 3-arg attributes unexpected (secdef=%, search_path_set=%, owner=%)',
      v3_secdef, v3_search, v3_owner;
  END IF;
  SELECT string_agg(DISTINCT ae.grantee::regrole::text, ',')
    INTO bad_grantees
    FROM pg_proc p, aclexplode(p.proacl) ae
   WHERE p.oid = v3 AND ae.privilege_type = 'EXECUTE'
     AND (ae.grantee = 0 OR ae.grantee::regrole::text NOT IN ('postgres','service_role'));
  IF bad_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT (post-state): 3-arg has unexpected EXECUTE grantees: %', bad_grantees;
  END IF;
  IF public.alert_delivery_idempotency_window_seconds() <> 79200 THEN
    RAISE EXCEPTION 'ABORT (post-state): authoritative cutoff is not 79200';
  END IF;
  RAISE NOTICE 'alert-delivery v2 (c) applied: 3-arg claim RPC + cutoff=79200s; 4-arg overload removed; ACL service_role-only';
END $post$;
