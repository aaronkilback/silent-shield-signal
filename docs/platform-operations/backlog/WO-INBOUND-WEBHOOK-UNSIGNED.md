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

## execute-approved-action — the worst one (fixed 2026-09-11, same branch/PR)

The Part B top-tier flag, investigated + fixed. **Deployed `verify_jwt=false` (v84), no in-function auth, docstring falsely claimed `verify_jwt=true` + role checks.** Anonymously reachable executor of the human-approval queue.
- **What it executes:** only actions already `status='awaiting_approval'` (can't invent one); runs the STORED `action_payload`. Executors: `propose_severity_correction` → UPDATE `signals` severity/severity_score/triage_override (any direction); `notify_oncall_via_slack` → POST arbitrary stored message to the on-call Slack webhook (pages a human). Approve/reject both flip `agent_actions.status` and stamped `approved_by`/`rejected_by` from the **forgeable request body**. Net: an anon could auto-approve/execute or reject ANY pending action and forge the approver — defeating the entire approval control.
- **External invocation:** edge logs across the observable window (24h + the 09-08 window) → **zero requests of any kind. No misuse.** Latent.
- **Legit caller:** only `src/components/agents/AgentActionApprovalQueue.tsx` (frontend, user session JWT, passing `approver_user_id: user.id`). No internal service-role caller.
- **Fix (built, no deploy):** gateway `verify_jwt=true`; in-function `getCallerIdentity` (401 fail-closed); **approver derived from the token, not the body** (kills forgery); user callers must hold an approver role (super_admin/admin/analyst via `user_roles`) AND have access to the action's `client_id` (`getAccessibleClientIds`); `service_role` bypasses. Nothing breaks: the frontend already sends the session JWT + the same user id.

## Review round 2 (2026-09-11) — A/D/E fixed, B/C open, F/G are deploy gates

Self-review of the round-1 diff: the signature fix closed the *anonymous* door but left the *cross-tenant authenticated* one — same class as the original defect. Fixed on #213:
- **A — JSON-path authorization (both ingest functions).** The `else`/JSON branch was authn-only: any authenticated user (any tenant) could inject into any case by naming its `file_number`/`intake_email_tag`. Now a JSON-path **user** caller must have access to the resolved case's `client_id` (checked post-routing via `getAccessibleClientIds`); `service_role` bypasses; Twilio/Mailgun form paths are provider-signature-gated. Fail-closed on null client_id. Same standard as send-sms.
- **D — execute-approved-action null-client.** The client check was *skipped* when `action.client_id` was null (agent actions are often null-client). Null-client = platform/global-scoped → now **requires super_admin** (enforced, not skipped); client-scoped still requires client access; `service_role` bypasses.
- **E — approver fallback + unchecked update.** Service-caller `approverId` is now a validated uuid or **null** (never the literal `'service_role'` against a nullable-uuid column). Both reject- and approve-path status updates are error-checked (approve fails loud → 500, does not execute on a failed transition).

**Open (tracked, NOT fixed):**
- **B — replay protection.** Mailgun `timestamp` freshness + `token` dedup; short-window guard for Twilio. No replay defense today.
- **C — Twilio `TWILIO_WEBHOOK_URL` fragility.** `req.url` behind the gateway may not equal Twilio's configured URL; fail-closed then rejects legit inbound. **Not verifiable from code — needs a live Twilio ping.**

**Deploy preconditions (must be proven or intake silently breaks):**
- **F — live provider verification.** After deploy, inbound SMS AND inbound email must EACH be proven against a **real** Twilio/Mailgun request landing as an investigation entry. The HMACs are unproven end-to-end; a wrong URL/key fails closed silently. Not "done" until both are observed working post-deploy.
- **G — `MAILGUN_SIGNING_KEY`** (webhook signing key, not API key) lands with the deploy or all inbound email 403s. `send-sms` + `execute-approved-action` deploy **without** `--no-verify-jwt`.

## Independent review round 3 (2026-09-11) — 2 real found, 2 stale, fixed on #213

An independent reviewer read the diff. Two genuine findings neither prior pass caught, both fixed:
- **#1 — payload target unbound (genuine cross-tenant WRITE).** `execute-approved-action` authorized the caller against `action.client_id`, but `executeSeverityCorrection` updated `signals` by `payload.signal_id` with **no check the signal belongs to that client**. An approver for client A could execute an A-scoped action whose (fleet-generated, possibly contaminated) payload points at a signal in client B → write to B. **Fixed:** bind the payload to the authorized scope — refuse null-client signal actions, require `signal.client_id === action.client_id`, and scope the UPDATE with `.eq('client_id', action.client_id)`. Refusal → action marked `failed` with reason, never executed.
- **#2 — double-execute race (TOCTOU).** Loaded on `status='awaiting_approval'` then updated by `id` only → two approvers / a double-click both pass the check and both execute. **Fixed:** the status transition is now a conditional compare-and-swap (`.eq('id').eq('status','awaiting_approval').select()`), must change exactly one row, else 409 — never executes twice. Applied to both approve and reject.
- **#3 — `config.toml` had no `[functions.ingest-email]` entry** → a redeploy could default it to `verify_jwt=true` and block Mailgun. **Fixed:** explicit `verify_jwt=false` added (reachability gated by signature + JSON authz, not the gateway).

**Two review findings were STALE** — the reviewer was given the round-1 (pre-`b4ff7e6c`) diff: the JSON-path authn-without-authz and the body-forgeable service-role approver were **already fixed** in `b4ff7e6c` (verified: `jsonCallerUserId` client-access check in both ingest fns; approver = `caller.userId`, never the body for a user). Not open.

**Accepted (not fixed, by ruling):**
- **Malformed-input 500s** — a non-JSON body to a JSON path throws → generic 500 after the auth gate. Accepted: it's post-gate, leaks nothing, writes nothing.
- **Pre-signature body parsing** — `req.formData()` is read before signature verification (necessary — the params ARE the signed content). Accepted: parsing a form body before verifying is standard and does not write/act; the signature check gates every write.

## Deploy 2026-09-11 (#213 merged as b9725fd8) — 3 of 4 deployed + verified; F cannot run (no live providers)

**Deployed to prod + four-point + Merged-And-Running verified (all from tree b9725fd8 = origin/main):**
- `execute-approved-action` v84→**85**, verify_jwt=**true** (probe: gateway 401) — auth + role/client authz + null-client→super_admin + CAS + payload-scope binding all in the served bundle. **This is the one that mattered (live frontend consumer, was the anon mutation executor).**
- `send-sms` v120→**121**, verify_jwt=**true** — authz block in bundle; gateway 401 on no-auth.
- `ingest-communication` v115→**116**, verify_jwt=**false** — Twilio signature (form-no-sig probe → **403**) + JSON-path authz (json-no-auth → **401**).

**Mailgun CANCELLED (operator, 2026-09-11).** `ingest-email` **NOT redeployed** — skipped by ruling. It is currently deployed **verify_jwt=true** (gateway-gated, anonymously unreachable; it had no config entry so its last deploy defaulted true). Config↔deployed divergence: the merged #3 sets config `verify_jwt=false`, deployed is `true`; harmless while unwired, and the merged fix fails closed without `MAILGUN_SIGNING_KEY` if ever redeployed. **Deployed-but-unwired, no provider.**

**F (live provider proof) CANNOT RUN — and that is itself the finding:** the entire investigation-SMS/email comms path has **never carried real traffic** — inbound SMS 0, outbound SMS 0, `[SMS RECEIVED]` entries 0, ever. So:
- F-email: void — Mailgun cancelled, no sender.
- F-SMS: not runnable — Twilio's inbound Messaging webhook target is **unverifiable from here (external console)** and, given zero traffic ever, almost certainly **not wired**. Texting the number likely won't reach `ingest-communication`.
- **The security fixes ARE live and verified** (the gates provably reject unauthorized/forged requests — 403/401 probes). What can't be proven is *functional intake*, because the feature has no live provider on either channel.

**WIRE-OR-RETIRE decision (operator, not decided here):** the investigation SMS/email comms feature (`send-sms` outbound, `ingest-communication` inbound SMS, `ingest-email` inbound email) appears **dormant/unwired** — deployed and now hardened, but with no observed traffic and no live provider (Mailgun cancelled; Twilio inbound webhook unconfirmed). Each should either get a wired provider or be retired (delete the function + its config entry). The signature/authz hardening is correct and harmless regardless. AEGIS email channel provider (Cloudflare Email Routing likely) is a **separate** decision — not scoped here.

## Companion doctrines
Provenance Doctrine, Population-Before-Check (the gap is a population — swept the whole set, not one function), Absence-Is-Not-A-Value (0 persisted ≠ 0 attempts), Confidence-is-not-correctness (grep hit-counts mislead — send-sms was verified by reading, not by count).
