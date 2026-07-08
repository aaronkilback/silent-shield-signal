# Alert Delivery v2 — staging deployment preflight (read-only verification + controlled fixture)

Run order: apply migrations → provision secret (env + vault) → set verified `ALERT_FROM_EMAIL` →
run the verifications below → create the controlled fixture → THEN (separate approval) enable the
staging cron / replace deny-all. None of these queries print, log, or return the secret value.

> **⚠ SUPERSEDED BY #71 B (2026-07-08).** The delivery gate no longer uses
> `alert_delivery_allowed_recipients` + `delivery_test_mode`. It now claims by **per-client
> recipient-membership** and re-verifies at send-time against **`client_alert_recipients`**
> (active + verified). The fixture below is retained for historical context; the current
> rollout procedure (verify a recipient, then enable per client) lives in the **#72** rollout
> runbook. To exercise delivery now: add an active+verified `client_alert_recipients` row for a
> client, and create a `finding`/`notification`/`interruption`-tier alert on that client's incident
> addressed to that recipient.

## A. Controlled synthetic acceptance fixture (staging only; run at provision time)
`<APPROVED_TEST_MAILBOX>` is the single operator-approved controlled mailbox.
```sql
INSERT INTO public.alert_delivery_allowed_recipients(email, note)
VALUES (lower('<APPROVED_TEST_MAILBOX>'), 'v2 staging acceptance — controlled test mailbox')
ON CONFLICT (email) DO NOTHING;

-- ONE deliberate synthetic fixture, marked, synthetic content only (no real-client data):
INSERT INTO public.alerts(channel, recipient, status, delivery_test_mode, response_json)
VALUES ('email', lower('<APPROVED_TEST_MAILBOX>'), 'pending', true,
        jsonb_build_object('subject','[V2 TEST] synthetic acceptance',
                           'body','Synthetic staging test alert. No real data.'));
```

## B. Secret-helper custody proof
```sql
-- (1) No API-exposed role holds EXECUTE on the secret reader:
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
 WHERE routine_schema='public' AND routine_name='get_alert_delivery_internal_secret';
--     expect: zero rows for anon / authenticated / service_role / PUBLIC.

-- (2) SECURITY DEFINER + fixed empty search_path:
SELECT prosecdef, proconfig FROM pg_proc WHERE proname='get_alert_delivery_internal_secret';
--     expect: prosecdef = true; proconfig contains 'search_path='.

-- (3) Runtime DENIAL for each API role (returns permission denied, never the value):
SET LOCAL ROLE anon;          SELECT public.get_alert_delivery_internal_secret(); RESET ROLE; -- expect ERROR
SET LOCAL ROLE authenticated; SELECT public.get_alert_delivery_internal_secret(); RESET ROLE; -- expect ERROR
SET LOCAL ROLE service_role;  SELECT public.get_alert_delivery_internal_secret(); RESET ROLE; -- expect ERROR

-- (4) The actual cron execution role CAN invoke it — prove PRESENCE only, never the value:
SELECT username AS cron_role FROM cron.job WHERE jobname = 'alert-delivery-v2-email-staging';
--     then, as that role / the owner the cron runs under:
SELECT (public.get_alert_delivery_internal_secret() IS NOT NULL) AS cron_role_can_read; -- expect true
```

## C. pg_net header access boundary + retention proof
The dedicated header is injected by the cron's `net.http_post`; it transiently lives in pg_net's
request records. Prove only privileged operational roles can read them. (Exact table names vary by
pg_net version — inspect whichever of `net.http_request_queue` / `net._http_response` /
`net.http_response` exist.)
```sql
-- (1) Read-grants on the net request/response relations:
SELECT n.nspname AS schema, c.relname AS rel, c.relacl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'net' AND c.relkind = 'r';
--     inspect relacl: expect NO read grant to anon / authenticated (ideally not service_role).

-- (2) Runtime denial for API roles against the net relations:
SET LOCAL ROLE anon;          SELECT count(*) FROM net.http_request_queue; RESET ROLE; -- expect ERROR
SET LOCAL ROLE authenticated; SELECT count(*) FROM net.http_request_queue; RESET ROLE; -- expect ERROR

-- (3) Retention: confirm header-bearing request rows are not retained long-term and are readable
--     only by privileged roles while present (pg_net drains the queue and TTL-expires responses):
SHOW pg_net.ttl;                                  -- version-dependent; or SELECT * FROM net.worker_settings;
SELECT count(*) AS pending_net_requests FROM net.http_request_queue; -- privileged role only
```

## D. Marker-gate DB proof (acceptance-time; mutates — run only in the controlled window)
```sql
-- Control: an allowlisted recipient row WITHOUT the marker must NOT be claimed.
INSERT INTO public.alerts(channel, recipient, status, delivery_test_mode, response_json)
VALUES ('email', lower('<APPROVED_TEST_MAILBOX>'), 'pending', false,
        jsonb_build_object('subject','[control] unmarked','body','must be ignored'));
SELECT id, delivery_test_mode
  FROM public.claim_pending_email_alerts('preflight-dryrun', 50, 120);  -- window is DB-authoritative (no caller arg)
--     expect: ONLY delivery_test_mode = true rows; the unmarked control is absent.
```
(The pure `claimEligible()` logic for these cases is already proven by unit tests; this is the
DB-level confirmation, run during the controlled acceptance window.)
