# WO-INBOUND-CALL-NOTIFY — Twilio-based inbound-call alert (built) + deferred Atlas summary

**Opened / built:** 2026-08-22.
**Status:** function BUILT + DEPLOYED. Operator sets the status callback URL in the Twilio console.

## Why Twilio, not Atlas
Twilio owns the call leg on the published number (`+1 825 904 8566`) and fires the status callback on
**every** inbound call **regardless of what the Atlas voice model does**. This matters: Atlas dropped a
call mid-conversation (2026-08-22), and a model-invoked Atlas **Action** is non-deterministic — the model
can skip it, so it cannot be relied on for a must-fire notification.

## What was built
`supabase/functions/inbound-call-notify` (Fortress prod `kpuqukppbmwebiptqmog`, `verify_jwt=false`):
- Receives a Twilio status callback (**form-encoded**), verifies **`X-Twilio-Signature`** (HMAC-SHA1 over
  the full public URL + sorted POST params, keyed with `TWILIO_AUTH_TOKEN`). Unsigned/invalid → **403**.
- Alerts on terminal statuses **completed, busy, no-answer, failed, canceled** — every inbound call incl. hangups.
- **Loop guard:** ignores callbacks whose `From` equals `AARON_ALERT_NUMBER` or `TWILIO_FROM_NUMBER`.
- Sends **one** SMS via the existing `send-sms operator_alert` mode → `AARON_ALERT_NUMBER`. Body is exactly
  **`Inbound call from {From}, {duration}s.`** — no transcript, summary, or recording link.
- No data-plane access. Reuses existing secrets only (`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `AARON_ALERT_NUMBER`, `SUPABASE_*`) — nothing new to provision.
- CI: allowlisted in `public-endpoints.json` + `config.toml` block (verify_jwt=false, signature-gated).

**Operator setup (manual):** Twilio Console → Phone Numbers → `+1 825 904 8566` → set the **status callback**
to `https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/inbound-call-notify` (POST), covering the terminal
call events. The signature is computed against that exact URL — if a different URL/path/query is used, the
HMAC will not match and requests will 403.

## Deferred — Atlas call-summary enhancement (LATER, do not build)
Once Atlas's platform-level webhook capability is confirmed (see the earlier report — `docs.atlas.bot` was
the wrong Atlas; the operator has the real docs), add a **second, best-effort** notification carrying the
AI **call summary + recording link** from Atlas. This is additive context on top of the Twilio must-fire
alert — never a replacement for it (Twilio remains the reliable per-call signal; Atlas is enrichment).
