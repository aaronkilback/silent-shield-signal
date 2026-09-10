# WO-INBOUND-WEBHOOK-UNSIGNED — public unsigned webhooks + the verify_jwt=false population (2026-09-10)

**Status:** Part A fixes BUILT (branch `fix/wo-inbound-webhook-unsigned`, PR open, NOT deployed). Part B population audit COMPLETE (report-only). Class: `verify_jwt=false` + external-controlled input + writes/acts + no authenticity validation → anyone with the URL can inject or spend.

---

## send-sms FIRST (it costs money) — CORRECTION to the prior report

Prior report called send-sms "an unauthenticated outbound sender." **That was wrong** (my grep pattern omitted `getClaims`). Reading the code:
- **Invocation requires auth:** `Authorization: Bearer <token>` → `supabase.auth.getClaims(token)` → **401 on missing/invalid**. So it is NOT anonymously invocable.
- **External reachability:** gateway `verify_jwt=false`, but the function self-gates via `getClaims`. A no-auth POST returns 401. Edge logs (≥3-day retention): **zero external POSTs**, only internal `OPTIONS` preflights. No misuse.
- **What a caller could send:** the REAL gap is **authorization depth** — any *authenticated* user (any role, any tenant) could send an SMS to any `to_number` on any `investigation_id` (fuzzy-resolved). A leaked low-priv token = arbitrary-SMS / toll vector. Internal caller `_shared/qualifier-handoff.ts` invokes it with the **service-role key** (operator alerts).
- **Evidence of misuse:** none (outbound comms + logs clean).
- **Fix built:** added AUTHORIZATION (caller must have access to the investigation's client via `getAccessibleClientIds`; `service_role` bypasses) + flipped config `verify_jwt=true` for gateway defense-in-depth (service key + user JWT both valid → neither caller breaks).

---

## ingest-communication + ingest-email — the confirmed unsigned inbound writers

**What they write:** both write `investigation_entries` (`entry_text` = attacker-controlled body, `created_by_name`) + `investigation_communications` (spoofable `From`/sender, `direction=inbound`) under SERVICE_ROLE. `ingest-communication` targetable by `file_number` (fuzzy `ilike`); `ingest-email` by `intake_email_tag`. `ingest-email` **captured** Mailgun's `timestamp`/`token`/`signature` but **never verified them**.

**Injection forensic (prod, 2026-09-10):** CLEAN — `investigation_communications` inbound = 0; `investigation_entries` via ingest = 0. **Edge-log probe check:** retention observably ≥3 days (events back to 2026-09-07); across the whole window **zero POSTs** to either function, only sporadic internal `OPTIONS/200` (platform publishable apikey, AWS IPs). **Latent, not active.** Caveat (Absence-Is-Not-A-Value): failed routing persists nothing, so 0-persisted ≠ 0-attempts, but logs show no POST attempts within retention.

**Fixes built:**
- `_shared/webhook-auth.ts` — `verifyTwilioSignature` (HMAC-SHA1 over URL + sorted params) + `verifyMailgunSignature` (HMAC-SHA256 over timestamp+token). Fail-closed.
- `ingest-communication`: Twilio signature on the form path (403 on fail); JSON path requires an authenticated caller (`getCallerIdentity`, 401).
- `ingest-email`: Mailgun signature on the form path (403 on fail); JSON path requires auth.

**Deploy preconditions (operator, not done here):** set `MAILGUN_SIGNING_KEY` secret (fail-closed until then — inbound email rejects); `TWILIO_AUTH_TOKEN` already set; optional `TWILIO_WEBHOOK_URL` if the proxied URL differs from Twilio's configured webhook URL.

---

## PART B — the verify_jwt=false population audit (247 = the population question, done properly)

**Method:** parsed config.toml → **246 functions with explicit `verify_jwt=false`** (functions with no entry default to gateway-enforced JWT and are excluded). Scored every one on: reads external input · has in-function auth gate · writes · costs money (LLM/Twilio/Resend/paid API). The gateway is genuinely public for `verify_jwt=false` (confirmed by no-auth curl reaching the function body), so these are all anon-reachable; the differentiator is the in-function gate + whether it acts.

**Result: 156 candidate open doors** (auth-gate=0 AND writes-or-cost). Top-tier VERIFIED by reading (no missed gate):
- **`execute-approved-action`** — no auth code at all; **executes agent actions (mutations)**. Highest consequence. Likely its own urgent WO.
- **`create-agent`** — ungated; writes the global agent registry.
- **`process-intelligence-document`, `osint-web-search`, `process-stored-document`, `knowledge-synthesizer`, `aegis-qualify`, `ai-decision-engine`, `vision-analysis`, `multi-model-consensus`** — ungated + read input + drive LLM/Google spend on attacker-controlled input (financial).
- **`process-feedback`** — comment claims "INTERNAL service-role pipeline" but nothing enforces it; writes learning data.

**Consequence tiers (156):**
1. **Financial + input-driven (≈48):** ungated LLM/paid-API callers reading external input — anon can burn spend with controlled prompts. (process-intelligence-document, osint-entity-scan, agent-knowledge-seeker, multi-agent-debate, red-team-review, scan-entity-photos, vision-analysis, …)
2. **Write/mutation + input-driven (≈40):** anon writes/mutates platform data. (execute-approved-action, create-agent, process-feedback, execute-signal-merge, merge-duplicate-entities, source-credibility-updater, detect-threat-patterns, check-incident-escalation, persist-report, configure-entity-monitoring, …)
3. **Trigger-only, no input (≈68):** cron-style functions (monitor-*, autonomous-*, thread-weaver, send-daily-briefing) — anon POST triggers a run (cost/DoS-amplification, not injection).

**Caveat / remaining work:** 156 is the static-signal candidate set. Top tier verified as genuinely ungated; a subset is **intentionally public** (aegis-qualify marketing chat, contact-submit, confirm-client-authorization, wildfire-portal-*, support-chat, auth-email-hook, heygen-webhook) and must be separated from accidental exposure. Full per-function intent-triage of all 156 is the remaining sweep. **Systemic finding: the platform-wide default is `verify_jwt=false` with inconsistent in-function gating** — this is a class defect, not N isolated bugs. Full scored table: `/tmp` sweep reproducible from `scripts` method above (attach to the WO on next pass).

**Sequence:** ingest-communication + ingest-email (built) → `execute-approved-action` (mutation executor, urgent) → financial tier → write tier → intentional-public documentation pass.

## Companion doctrines
Provenance Doctrine, Population-Before-Check (the gap is a population — swept the whole set, not one function), Absence-Is-Not-A-Value (0 persisted ≠ 0 attempts), Confidence-is-not-correctness (grep hit-counts mislead — send-sms was verified by reading, not by count).
