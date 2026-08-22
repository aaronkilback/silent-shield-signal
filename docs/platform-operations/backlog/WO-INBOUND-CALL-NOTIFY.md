# WO-INBOUND-CALL-NOTIFY — inbound-call alert (Atlas platform webhook)

**Built:** 2026-08-22. Repointed Twilio → **Atlas** same day once Atlas platform webhooks were confirmed
(`https://docs.youratlas.com/docs/webhooks/webhooks`). **Status:** deployed. Operator runs the two subscribes.

## Source: Atlas platform webhooks (not a model Action, not Twilio directly)
Atlas fires `call_started` / `call_completed` platform webhooks on **every** call, independent of the voice
model (a model-invoked Action is unreliable — Atlas dropped a call mid-conversation). Atlas already owns the
Twilio status callback, so **the Twilio callback is NOT touched.** The prior Twilio X-Twilio-Signature HMAC
verifier is kept in the function but **unused**, so we can revert to a Twilio status callback without a rewrite.

## Function (`supabase/functions/inbound-call-notify`, Fortress prod, verify_jwt=false)
- **Auth:** Atlas does not sign — a random token is the **last URL path segment**; must equal
  `ATLAS_WEBHOOK_PATH_TOKEN` (set as a secret), else **403**. The hookUrl is the secret (HTTPS + hard-to-guess path).
- **Payload:** Atlas body is a **JSON array containing one event object**; parse `[0]`.
- **Two subscriptions:** `call_started` and `call_completed`, both `campaignId: "*"`, `provider: "custom"`,
  same hookUrl. Event type inferred from `type`/presence of `durationSeconds`/`endedReason`.
- **De-dupe (at-least-once):** atomic INSERT into `atlas_call_notify_dedupe (call_id, event_type)` — the PK
  serializes; a duplicate delivery hits `23505` and is skipped. 2-day nightly purge cron. (Table + cron
  applied to prod via MCP.)
- **Respond 2xx immediately, then process** (dedupe + SMS) in `EdgeRuntime.waitUntil` — slow endpoints time out.
- **Loop guard:** ignore events whose `customerNumber` equals `AARON_ALERT_NUMBER` or `TWILIO_FROM_NUMBER`.
- **SMS (via `send-sms operator_alert` → AARON_ALERT_NUMBER):**
  - `call_started` → `Inbound call from {customerNumber}.`
  - `call_completed` → `Call ended — {customerNumber}, {durationSeconds}s. {endedReason}.`
  - **Never** `callSummary` / `callTranscript` / `audioUrl` — those stay in Atlas.
- Reuses existing secrets (`AARON_ALERT_NUMBER`, `TWILIO_FROM_NUMBER`, `SUPABASE_*`) + the new
  `ATLAS_WEBHOOK_PATH_TOKEN`. CI: config.toml block + `public-endpoints.json` allowlist entry (verify_jwt=false).

## Revert path
If Atlas webhooks prove unreliable: re-enable the (still-present) Twilio `_twilioSignature` verifier as the
auth, point Twilio's status callback back at the base URL, and drop the Atlas subscriptions. No rewrite needed.
