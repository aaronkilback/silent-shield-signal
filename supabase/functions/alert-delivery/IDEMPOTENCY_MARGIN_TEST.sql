-- IDEMPOTENCY_MARGIN_TEST.sql — STAGING-ONLY boundary proof for the retry cutoff.
-- Run during re-acceptance AFTER applying migration 20260628000003 (NOT a migration itself).
-- Pure RPC-level test: synthetic MARKED fixtures only, NO provider send, NO real recipient, NO cron.
-- Wrapped in a transaction that ROLLBACKs -> leaves zero rows behind. Does not touch unrelated alerts.
BEGIN;

-- (1) Single authoritative cutoff value is present and == 79200s (22h), strictly inside Resend's 24h.
DO $$ BEGIN
  ASSERT public.alert_delivery_idempotency_window_seconds() = 79200,
         'authoritative cutoff must be 79200s (22h)';
  ASSERT public.alert_delivery_idempotency_window_seconds() < 86400,
         'cutoff must be STRICTLY inside the provider 24h retention';
END $$;

-- (2) Seed three lease-expired 'sending' marked fixtures at: just-inside / exactly-at / beyond cutoff.
WITH w AS (SELECT public.alert_delivery_idempotency_window_seconds() AS s)
INSERT INTO public.alerts (channel, recipient, status, delivery_test_mode, delivery_key,
                           idempotency_anchor_at, lease_expires_at, attempt_count, response_json)
SELECT 'email', 'margintest+'||tag||'@example.com', 'sending', true, 'mk_'||tag,
       now() - make_interval(secs => age), now() - interval '1 minute', 1,
       jsonb_build_object('subject','[MARGIN TEST]','body','synthetic - no real data')
FROM (VALUES
  ('inside', (SELECT s FROM w) - 300),   -- just inside cutoff -> MUST be reclaimed (same key)
  ('atcut',  (SELECT s FROM w)),          -- exactly at cutoff   -> MUST reconcile (no claim/send)
  ('beyond', (SELECT s FROM w) + 300)     -- beyond cutoff       -> MUST reconcile (no claim/send)
) v(tag, age);

-- (3) Claim with NO window argument (authoritative cutoff is used internally by the RPC).
CREATE TEMP TABLE _claimed ON COMMIT DROP AS
SELECT id FROM public.claim_pending_email_alerts('margin-test', 50, 120);

-- (4) Assert the boundary behaviour.
DO $$
DECLARE
  inside_claimed boolean; atcut_claimed boolean; beyond_claimed boolean;
  inside_key text; atcut_status text; beyond_status text;
BEGIN
  SELECT EXISTS(SELECT 1 FROM _claimed c JOIN public.alerts a ON a.id=c.id WHERE a.delivery_key='mk_inside') INTO inside_claimed;
  SELECT EXISTS(SELECT 1 FROM _claimed c JOIN public.alerts a ON a.id=c.id WHERE a.delivery_key='mk_atcut')  INTO atcut_claimed;
  SELECT EXISTS(SELECT 1 FROM _claimed c JOIN public.alerts a ON a.id=c.id WHERE a.delivery_key='mk_beyond') INTO beyond_claimed;
  SELECT delivery_key FROM public.alerts WHERE delivery_key='mk_inside' INTO inside_key;
  SELECT status::text  FROM public.alerts WHERE delivery_key='mk_atcut'  INTO atcut_status;
  SELECT status::text  FROM public.alerts WHERE delivery_key='mk_beyond' INTO beyond_status;

  ASSERT inside_claimed,                            'just-inside cutoff MUST be reclaimed';
  ASSERT inside_key = 'mk_inside',                  'reclaim MUST preserve the stable delivery_key';
  ASSERT NOT atcut_claimed,                         'at cutoff MUST NOT be claimed (no provider-send path)';
  ASSERT atcut_status = 'requires_reconciliation',  'at cutoff MUST transition to requires_reconciliation';
  ASSERT NOT beyond_claimed,                        'beyond cutoff MUST NOT be claimed (no provider-send path)';
  ASSERT beyond_status = 'requires_reconciliation', 'beyond cutoff MUST transition to requires_reconciliation';
  RAISE NOTICE 'IDEMPOTENCY MARGIN TEST PASSED (cutoff=79200s/22h): inside=reclaim(stable key); at/beyond=reconcile, zero provider-send path';
END $$;

ROLLBACK;  -- leave NO test rows behind
