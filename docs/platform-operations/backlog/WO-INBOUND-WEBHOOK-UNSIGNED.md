# WO-INBOUND-WEBHOOK-UNSIGNED — public unsigned inbound webhooks accept spoofable input (2026-09-10)

**Status:** OPEN — live defect, report-only (do not build yet). Ahead of WO-AEGIS-INBOUND-CHANNELS; the AEGIS channel must not be built on this pattern.

**Class:** unauthenticated public webhook (`verify_jwt=false`) that parses **attacker-controllable external input** and **writes/acts** with **no caller-authenticity validation** (no provider signature, no shared secret, no service-role self-gate). The gateway does not enforce a JWT and the function does not re-establish trust — so anyone with the URL can inject.

## 1. What `ingest-communication` writes, and where

Entry paths (both `verify_jwt=false`, no signature check):
- **Twilio form path** (`application/x-www-form-urlencoded`): reads `From` (→ `normalizePhone`), `Body`, `MessageSid`, `To` — all attacker-settable in a raw POST.
- **JSON path** (anything else): `source`, `sender`/`from`, `message`/`body`/`text`, `metadata` — fully arbitrary; even easier to forge (no MessageSid needed).

Routing → then two writes under SERVICE_ROLE (RLS bypassed):
1. Case match: a case-ref regex in the body (`INV-…`, `FILE-…`, `[TAG]`) via **`ilike '%ref%'` fuzzy match** on `investigations.file_number` (loose — a partial ref can hit an unintended case), OR fallback to a number that has a prior **outbound** SMS.
2. **`investigation_entries`** ← `entry_text` = `[SMS/EMAIL RECEIVED — From: <spoofable> — ts]\n\n<attacker body>`, `created_by_name = "<label> Ingest (<spoofable>)"`. **This is the injection: attacker-controlled text written into a case file as a received communication.**
3. **`investigation_communications`** ← `message_body`, `contact_identifier` = spoofed `From`, `direction=inbound`, `investigator_user_id` = the last outbound investigator or the placeholder `00000000-…`, `provider_message_id` = `MessageSid` (or null on the JSON path).

**Impact:** forged evidence in an investigation record, attributed to a real contact number, with no authenticity trail. Targetable at a specific case by `file_number` (guessable/fuzzy). Corrupts the integrity of an intelligence artifact — the exact provenance failure class the platform's doctrines exist to prevent.

## 2. Has anything been injected? (forensic, prod 2026-09-10)

Clean — **no persisted injection found**:
- `investigation_communications` `direction=inbound`: **0 rows** (0 placeholder-investigator, 0 from-never-texted-numbers, 0 null-SID sms).
- `investigation_entries` created via ingest (`created_by_name ~ 'Ingest'` / `[SMS RECEIVED`/`[EMAIL RECEIVED` prefix): **0 rows**.

**Caveat (Absence-Is-Not-A-Value):** the function **persists nothing when routing fails** (returns empty TwiML / 422) and logs attempts only to `console`. So **0 persisted ≠ 0 attempts** — a probe that failed to route leaves no DB trace. Attempt evidence lives only in edge-function logs (limited retention). *Open follow-up: grep edge logs for POSTs to `ingest-communication` to distinguish "never probed" from "probed, failed to route."* Not yet run.

## 3. What signature validation requires

**Twilio (`X-Twilio-Signature`):** HMAC-SHA1, base64-encoded, computed over the full request URL **+ the POST params sorted alphabetically and concatenated key+value**, keyed by the Twilio **auth token**; compare constant-time to the header; reject on mismatch. This proves the request came from Twilio.
- **Necessary but NOT sufficient** for a command/identity channel: Twilio still delivers a spoofable/SIM-swapped `From`. Signature stops *forged POSTs*; it does not prove *who texted*. For investigation intake: signature + a known-contact allowlist (the `From` must match a contact already on the case). For an AEGIS command channel (WO-AEGIS-INBOUND-CHANNELS): signature + a second factor.
- **JSON/email path** needs its own authenticity proof (provider inbound-parse signature, or DKIM/DMARC verified result) — a bare JSON POST has none today.

## 4. Population — the SAME gap is not scoped to this function

**Population definition:** every `verify_jwt=false` function that is (a) externally reachable, (b) parses external-controlled input, and (c) writes or acts, **without** validating caller authenticity (signature / shared secret / service-role self-gate / token). There are **247** `verify_jwt=false` functions total; the at-risk subset is the external-input actors. Swept the obvious external ingesters (`signature` / `caller-gate` / `writes` hit-counts):

| Function | signature | caller-gate | writes/acts | Verdict |
|---|---|---|---|---|
| **ingest-communication** | 0 | 0 | 2 | **CONFIRMED GAP** (this WO) |
| **ingest-email** | 0 | 0 | 2 | **CONFIRMED — identical gap** (unsigned inbound email → writes) |
| **send-sms** | 0 | 0 | 2 | **ADJACENT** — unauth *outbound* sender → toll-fraud / spam on your Twilio acct + writes logs |
| **oauth-token** | 0 | 0 | 2 | **REVIEW** — token exchange, no signature/gate on my patterns; confirm it validates via the OAuth code/PKCE flow or it's a token-minting gap |
| ingest-email-intel | 3 | 0 | 2 | **VERIFY** — has signature-shaped code; confirm it actually validates (DKIM/secret) vs merely references |
| wildfire-portal-log | 0 | 1 | 1 | **VERIFY** — has a caller-gate; confirm sufficiency |
| webhook-management | 1 | 1 | 3 | likely OK (has both); confirm |
| webhook-dispatcher | 0 | 0 | 0 | lower risk (no direct write); confirm |

**Not yet exhaustive.** A complete audit of the 247 `verify_jwt=false` set — classifying each as internal-only (cron/service-role/frontend-supplied-identity) vs externally-reachable-actor-without-validation — is part of this WO. `send-mfa-code`, `contact-submit`(absent locally), `heygen-webhook`(absent), `auth-email-hook`(absent) and others need the same triage. **This sweep, audit-only first, is the deliverable — not a fix per function.**

## Fix shape (NOT authorized — for the fix WO)
Provider-authenticity at the door for every external webhook: Twilio signature, DKIM/DMARC for email, HMAC/shared-secret for internal callers; reject-closed on failure. Then the tighter, per-surface rule (known-contact allowlist for intake; second factor for command). Sequence: **ingest-communication + ingest-email first** (confirmed, writing to case files), then the population audit, then the adjacent abuse surfaces (`send-sms`, `oauth-token`).

## Companion doctrines
Provenance Doctrine (a forged case entry is an ownerless/unauthenticated artifact), Population-Before-Check (the gap is a population, not one function — sweep the whole `verify_jwt=false` set), Absence-Is-Not-A-Value (0 persisted injections ≠ 0 attempts; the producer records no attempt marker). Blocks the pattern WO-AEGIS-INBOUND-CHANNELS would otherwise inherit.
