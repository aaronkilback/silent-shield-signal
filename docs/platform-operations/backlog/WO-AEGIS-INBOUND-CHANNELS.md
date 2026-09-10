# WO-AEGIS-INBOUND-CHANNELS — reach AEGIS from a phone (inbound only) (2026-09-10)

**Status:** SCOPED — do not build. Blocked on WO-INBOUND-WEBHOOK-UNSIGNED (must not inherit the unsigned-webhook pattern).

**Requirement:** the operator needs to reach AEGIS from a phone — ask questions, get answers, hand it tasks. **Inbound only.** Outbound (agents contacting the operator) is a separate problem that waits on the fleet + the belief freeze.

## HEADLINE ARCHITECTURE PRINCIPLE (ratified, do not relitigate)
**The bridge owns identity and scope — never the assistant. A spoofable channel never auto-grants super-admin.**
`dashboard-ai-assistant` runs under SERVICE_ROLE and trusts a caller-supplied `userId`/`tenantId`; it self-authenticates nothing (built to sit behind the authed browser). So a channel bridge — not the assistant — must (1) validate provider authenticity, (2) resolve sender → verified user, (3) assign a bounded, channel-scoped capability set, (4) call the assistant with *resolved* (not caller-claimed) identity. A phone number / email address is a weak credential; it maps to a bounded scope + a second factor for anything elevated, never to super-admin on a bare match.

## DESIGN DECISION (made 2026-09-10, do not relitigate): EMAIL IS THE FIRST CHANNEL, not SMS
Rationale: better auth story (DKIM/DMARC gives a verifiable authenticity result, *if enforced*), no character limit (real questions/answers), natural threading, and the reply-token second factor fits cleanly in an email thread. **SMS comes later, if at all.** (SMS `From` is caller-ID-spoofable and the existing inbound SMS webhook is unsigned — see WO-INBOUND-WEBHOOK-UNSIGNED.)

## 1. What already exists
| Function | Gateway | Shape | Fit |
|---|---|---|---|
| **dashboard-ai-assistant** | `verify_jwt=false` | SSE + non-stream; full AEGIS tools, tenant-scoping, propose-not-execute | The real ask+task surface. Trusts caller-supplied `userId`/`tenantId`; no self-auth. Non-stream path (`stream!==true`) suits email. |
| **respond-as-agent** | verify_jwt (default true) | non-stream, single agent persona + conversation | validates a user JWT (which a channel sender lacks); persona-oriented, not general |
| **briefing-chat-response** | `verify_jwt=true` | briefing/report Q&A | narrow; needs a JWT |

Change needed: a non-streaming path (exists), an identity bridge supplying trusted scope, output shaping. The assistant is reusable; the missing piece is everything in front of it.

## 2. Twilio (for the later SMS phase)
Account LIVE — `send-mfa-code` (SMS OTP; ties operator phone→account via `user_mfa_settings.phone_number`+`phone_verified`), `dispatch-critical-sms` (cron → operator phone `OPERATOR_UID=d7edb69f… ak@`, 320-char, once-daily), `send-sms` (investigation comms), `system-watchdog`. Inbound plumbing exists (`ingest-communication`, unsigned — the defect WO). Number is the `TWILIO_PHONE_NUMBER` secret (not read here).

## 3. The identity problem (the auth surface)
Anchor exists: `user_mfa_settings.phone_number`/`phone_verified` + `OPERATOR_UID`. Bridge = inbound sender → verified user → role. Holes: (a) inbound webhook does not validate provider signature (spoofable POST); (b) `From`/email-From is spoofable end-to-end. So identity requires: provider authenticity (signature / DKIM-DMARC pass) **and** a bounded scope on match **and** a second factor for elevated intent. The assistant performs no super-admin check of its own — the bridge must own the scope decision and never hand it operator/super-admin scope on a bare match.

## 4. Tasking — answer vs do
- Answer (read): assistant read tools bound to the operator's own scope — safe once identity is established.
- Do (act): the assistant is already propose-not-execute (mutations delegate to functions that re-validate scope server-side).
- **Rule (operator, adopted):** everything on the **Standing-Authority stop list is hard-refused over a channel regardless of sender** — prod deploy/migration, client-data/tenant-boundary crossing, activating dormant code, deleting/cancelling records, ambiguous fixes, credential/outward-facing actions. The refusal fires **at the bridge, before the assistant is called**. A channel gets a strict allowlist ⊂ the full tool set: read + propose only.

## 5. Email as a channel (the first channel)
Inbound needs a provider inbound-parse (SendGrid/Mailgun) or Cloudflare Email Routing → Worker → function. `ingest-communication` nominally accepts "email forwards" but only as manual/API JSON — no signed inbound-email wired. Auth stronger than SMS **only if** DKIM/DMARC is enforced and the bridge checks the verified result (forwarding breaks DKIM alignment). Fits the reply-token second factor naturally.

## Build preconditions (gated on operator ruling; nothing built)
1. WO-INBOUND-WEBHOOK-UNSIGNED resolved — the channel must not inherit the unsigned-webhook pattern.
2. Provider-authenticity validation is mandatory at the door (DKIM/DMARC for email).
3. Bounded scope on identity match + second factor for elevated actions; never auto-super-admin.
4. Thin bridge owns identity + scope + stop-list refusal; calls `dashboard-ai-assistant` non-streaming with resolved identity.

Out of scope: outbound agent→operator contact (waits on fleet + belief freeze).
