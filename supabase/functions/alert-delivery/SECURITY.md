# Alert Delivery v2 — secret custody & isolation

## Function-level authority
`ALERT_DELIVERY_INTERNAL_SECRET` is a **project Edge Function secret** (Deno env), used **solely**
as the function-level authorization credential for `alert-delivery` v2. The handler validates the
`x-alert-delivery-internal` request header against it with a constant-time comparison **before** any
service-role client, DB read/write, provider init, or outbound call. A service-role (or user) bearer
**alone is rejected** — service-role is transport only, never authority.

## Where the value lives (two copies, same value, staging only)
1. **Edge Function secret** `ALERT_DELIVERY_INTERNAL_SECRET` — read by the handler (`Deno.env`).
2. **Vault secret** `alert_delivery_internal_secret` — read **only** by the pg_cron job, via
   `public.get_alert_delivery_internal_secret()`, to inject the header.

The value is **never** written to: source, migrations, the cron command text (the cron calls the
reader **function**, not the literal), `pg_net` request records (header is a function result, not a
stored literal), logs, test output, response bodies, or error metadata (`classifyError` returns a
fixed vocabulary only).

## Database-helper isolation (`get_alert_delivery_internal_secret`)
- `SECURITY DEFINER` with **`SET search_path = ''`** (fully-qualified `vault.decrypted_secrets`).
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` — **no API-exposed role** can call
  it; it is therefore **not reachable through PostgREST/RPC**. Only the function owner (the role the
  pg_cron job runs as) can invoke it.
- Returns `NULL` if unset → cron sends an empty header → handler returns 401 (fail-closed).

Verification queries (run read-only after migration apply):
```sql
-- expect: no rows for public/anon/authenticated/service_role
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
 WHERE routine_name='get_alert_delivery_internal_secret';
-- expect: prosecdef=true, proconfig contains search_path=
SELECT prosecdef, proconfig FROM pg_proc WHERE proname='get_alert_delivery_internal_secret';
```

## Rotation procedure (staging)
Rotate **both** copies to the same new value, atomically from the caller's view:
1. Generate a new high-entropy value (≥32 bytes); never print it.
2. Update the vault copy:
   `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='alert_delivery_internal_secret'), '<new>');`
3. Update the Edge Function secret `ALERT_DELIVERY_INTERNAL_SECRET` (dashboard / CLI / Management API)
   to the **same** value.
4. Because cron reads the vault value at call-time and the handler reads env at call-time, a brief
   skew between steps 2–3 only causes 401s (fail-closed, no data risk), self-healing once both match.
5. Re-run the staging acceptance auth tests.

`RESEND_API_KEY`, `ALERT_FROM_EMAIL` (fixed verified sender), and `SUPABASE_*` remain standard Edge
Function secrets and are likewise never logged or returned.
