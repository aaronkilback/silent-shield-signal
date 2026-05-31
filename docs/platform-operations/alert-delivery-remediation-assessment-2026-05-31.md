# Alert Delivery Remediation Assessment

**Operator-directed 2026-05-31 (Task #141).** Read-only diagnosis answering eight focused questions. No code, no configuration changes, assessment only.

P1.4 post-deploy validation: **CRITICAL finding fires correctly** — *"alert-delivery: 1000 undispatched alert(s) older than 30 min (oldest 345358 min)"* (the "1000" is a Supabase JS `.select()` default limit, not the real count; actual is 13,857 per Task #139).

---

## §0 — Topology First (Critical Pre-Finding)

There are **TWO** alert-delivery functions, not one:

| Function | File | LOC | Channels | Triggered by | Status |
|---|---|---:|---|---|---|
| `alert-delivery` | `supabase/functions/alert-delivery/index.ts` | 198 | **Email only** (Resend) | `alert-delivery-2min` cron every 15 min | Active; runs hourly returning zero work |
| `alert-delivery-secure` | `supabase/functions/alert-delivery-secure/index.ts` | 456 | **Teams + Slack + SMS** (Twilio) | Direct invoke by `incident-manager`, `ingest-signal` | Active; writes the 13,857 failures |

These are sibling pipelines with **no shared substrate**. They each write to the `alerts` table but with different `channel` values and different lifecycle semantics:

- `alert-delivery` expects `status='pending'`, transitions to `'sent'` or `'failed'`
- `alert-delivery-secure` writes a SINGLE summary row with `channel='secure_messaging'` AFTER attempting all three channels in parallel, with `status='sent'` if ANY channel succeeded, else `'failed'`

This topology is not documented anywhere visible. The naming is misleading: `alert-delivery` is the legacy/email-only path; `alert-delivery-secure` is the multi-channel path. **Neither function knows the other exists.**

---

## §1 — What function sends alerts?

**Two functions, neither talking to each other.**

### `alert-delivery` (legacy, email)
- Endpoint: `supabase/functions/alert-delivery/index.ts`
- Lifecycle: polls `alerts` table for `status='pending'` rows; processes up to 20 per run; emails via Resend
- Cron: `alert-delivery-2min` runs every 15 min (despite name; cron is `4,19,34,49 * * * *`)
- **Current behavior:** zero rows match `status='pending'` (all 13,868 are `'failed'`), so each run does nothing and returns success
- **Channel handled:** `email` only — non-email channels just `console.log("not yet implemented")`

### `alert-delivery-secure` (multi-channel)
- Endpoint: `supabase/functions/alert-delivery-secure/index.ts`
- Lifecycle: directly invoked with a `SecureAlertPayload` (priority, channels, recipients, etc.); attempts Teams + Slack + SMS in parallel; writes single summary row
- No cron — called from `incident-manager` and `ingest-signal`
- Channels: Teams (webhook), Slack (webhook), SMS (Twilio)
- **Currently fails 100% of attempts** because webhooks and phone numbers aren't configured

### Where alerts come from

`alert-delivery-secure` is invoked when:
- An incident is created/escalated (via `incident-manager`)
- Specific severity-threshold signal ingestion (via `ingest-signal`)
- Reference: `supabase/functions/_shared/deployment-verification.ts` also mentions it

---

## §2 — What exact environment variables or settings are missing?

`alert-delivery-secure` reads three classes of configuration:

### Class 1 — Environment variables (Supabase secrets)

| Var | Used by | Currently set? |
|---|---|---|
| `SUPABASE_URL` | Both functions | ✓ yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Both | ✓ yes |
| `RESEND_API_KEY` | `alert-delivery` (email) | unknown — function never reaches a path where this would matter (no pending email rows ever exist) |
| `APP_URL` | Both (dashboard link in alert body) | falls back to `https://fortress.silentshieldsecurity.com` if unset |
| **`TWILIO_ACCOUNT_SID`** | `alert-delivery-secure` SMS | unknown; never tested because SMS never reaches it |
| **`TWILIO_AUTH_TOKEN`** | `alert-delivery-secure` SMS | unknown |
| **`TWILIO_FROM_NUMBER`** | `alert-delivery-secure` SMS | unknown |

The SMS path checks `twilioAccountSid && twilioAuthToken && twilioFromNumber` and falls back to `"Twilio credentials not configured"`. We see `"No phone numbers configured"` instead, meaning execution doesn't even reach the Twilio check — it stops earlier on the numbers list being empty.

### Class 2 — `intelligence_config` table rows

The function falls back to DB-stored config if the payload doesn't supply webhooks:

| Key | Status (empirically verified) | Used by |
|---|---|---|
| `teams_webhook_url` | **NOT PRESENT** in `intelligence_config` | Teams channel |
| `slack_webhook_url` | **NOT PRESENT** | Slack channel |
| `sms_alert_numbers` | **NOT PRESENT** | SMS channel (array of phone numbers) |

Confirmed via SELECT against prod: `intelligence_config` has 81 rows but **none of the three webhook/SMS keys exists**. The other ~80 keys are `fortress_data_access_*` and `monitoring_suggestions_*` entries plus thresholds/booleans.

### Class 3 — Payload-supplied recipients (per-invocation)

The payload can supply `recipients.teams_webhook`, `recipients.slack_webhook`, `recipients.sms_numbers`. Callers (`incident-manager`, `ingest-signal`) currently don't supply these (would need to check their code to confirm; the failed rows show all three blank).

### Summary

**Three things are unconfigured:**
1. No Teams webhook (env or `intelligence_config`)
2. No Slack webhook (env or `intelligence_config`)
3. No SMS phone numbers (env or `intelligence_config`)
4. Twilio credentials status: **unknown** (SMS path never gets that far)

Email config status is also uncertain — `RESEND_API_KEY` might be set, but `alert-delivery` has never had work to do (no pending rows), so we can't confirm email actually works either.

---

## §3 — Are Slack, Teams, SMS, and email all supposed to be active?

### Per the code's intent

- `alert-delivery-secure` is built to fan out to **Teams + Slack + SMS in parallel** when the payload includes all three channels — and the failed alerts show payloads with `"channels": ["teams", "slack", "sms"]`, indicating the callers DO request all three for every alert
- `alert-delivery` is built for email-only
- The two are NOT integrated — sending a multi-channel `alert-delivery-secure` invocation does not also send an email via `alert-delivery`

### Per the data

- 100% of `alert-delivery-secure` rows have `channels: [teams, slack, sms]` (all three, no email)
- 0% have `channel: 'email'` in the same row family
- `alert-delivery` legacy path has zero `pending` rows ever resolved

### Inferred intent

The system was designed so that **every signal-generated alert fires Teams + Slack + SMS in parallel** with no email. Email exists as a legacy/separate path with no current source. There is no documentation confirming this intent, but the data + code shape clearly demonstrate it.

### Inconsistency worth flagging

The `alerts.channel` enum column in DB takes values like `'email'`, `'secure_messaging'`, etc. But `secure_messaging` is a wrapper label — the actual channels attempted (per `response_json.payload_summary.channels`) are `[teams, slack, sms]`. There is no representation of "one alert per channel"; one row represents "multi-channel delivery attempt." This makes per-channel observability harder.

---

## §4 — Which tenants should receive which channels?

**There is no per-tenant routing today.**

Evidence:
- `alert-delivery-secure` reads `intelligence_config` (a global config table — no `tenant_id` scope on the keys we'd care about: `teams_webhook_url`, `slack_webhook_url`, `sms_alert_numbers`)
- `clients` table doesn't have webhook/SMS columns (per earlier schema reads)
- `tenants` table is empty (0 rows; tenant_id is just a UUID column elsewhere)
- The 13,474 orphan-tenant alerts and the 365 real-client alerts all carry the SAME `[teams, slack, sms]` channel intent
- Per-tenant `teams_webhook_url_<tenant_id>` or similar key naming doesn't appear in `intelligence_config`

### What that means for remediation

If Petronas Canada has a security oncall channel different from Cascade Energy's, the current architecture cannot route to them differently. Adding tenant routing is a real architectural change, not a config change.

Three possible models the operator could choose:
- **Model A — Global**: one Teams/Slack/SMS for all tenants (matches current code; cheapest fix)
- **Model B — Per-tenant**: routing layer keyed on alert's tenant_id; needs new schema columns or per-tenant config keys
- **Model C — Per-incident-class**: route by severity/category rather than tenant

Model A is what's wired today. The other two are architectural decisions.

---

## §5 — Is there a fallback path if one channel is not configured?

**No fallback exists today.** Each channel runs independently in parallel:

```typescript
// Pseudo-shape of alert-delivery-secure
const deliveryPromises = [];
if (channels.includes('teams')) deliveryPromises.push(deliverToTeams());
if (channels.includes('slack')) deliveryPromises.push(deliverToSlack());
if (channels.includes('sms'))   deliveryPromises.push(deliverToSms());
await Promise.all(deliveryPromises);
// status='sent' if ANY succeeded; 'failed' if all failed
```

If Teams is unconfigured but Slack works, the row gets `status='sent'` (because Slack succeeded). Currently all three are unconfigured, so all three fail and the row gets `status='failed'`.

### What's missing

- No "escalation" — failure on all primary channels doesn't trigger a secondary fallback (e.g., escalate to email, or page a backup)
- No retry on transient failures — a Twilio 5xx fails the row permanently
- No dead-letter-queue inspection workflow for failed alerts (they just accumulate)
- No "any channel succeeds" SLO — the success criterion is implicit (any-of-N) but not declared

### Notable design observation

The implicit "any channel succeeds = sent" is in §6 below; it's the right semantic but should be explicit.

---

## §6 — Should an alert be considered "sent" only when at least one channel succeeds?

### What the code currently does

`alert-delivery-secure` line 413 (approximate):
```typescript
status: Object.values(deliveryResults).some(r => r.success) ? 'sent' : 'failed'
```

**Already implements "any channel succeeds → sent."** This is the right behavior — it means a degraded-but-working delivery is recorded as success.

### What's missing

- **Per-channel observability** — the summary row says "sent" but doesn't surface "SMS failed silently while Teams worked." The `delivery_results` JSON has it, but no downstream consumer reads per-channel state.
- **Critical-channel SLO** — there's no concept that some channels MUST succeed (e.g., "an actively-paged oncall must receive SMS"). The current semantic treats all channels as fungible.
- **Soft-fail by design** — if 2 of 3 channels are unconfigured, the third works, and we get `status='sent'`, the partial-failure is invisible. The watchdog's P1.4 check (`sent_at IS NULL`) doesn't catch this case because `sent_at` is populated even on partial-failure rows.

### Recommended semantic refinement

- **`status='sent'`** when ≥1 channel succeeded (current behavior — keep)
- **Add `status='degraded'`** when sent but ≥1 expected channel failed; or
- **Add `delivery_quality` enum column** (`full` / `degraded` / `none`) computed from delivery_results
- Watchdog adds a sister check: `status='sent'` but `delivery_results.<channel>.success=false` for any channel-the-operator-cares-about

That refinement is design work, not minimum-fix. The current "any-succeeded" semantic is acceptable as-is for the minimum safe fix.

---

## §7 — What is the minimum safe fix?

A graduated set of minimum fixes, smallest first:

### Tier A — Make Teams + Slack work (≤30 min)

The cheapest possible fix to restore non-trivial alert delivery:

1. Create or obtain a **Teams Incoming Webhook URL** (single URL per channel; one-time setup)
2. Create or obtain a **Slack Incoming Webhook URL**
3. Insert two rows into `intelligence_config`:
   ```sql
   INSERT INTO intelligence_config (key, value) VALUES
     ('teams_webhook_url', '{"url": "<actual_webhook>"}'),
     ('slack_webhook_url', '{"url": "<actual_webhook>"}');
   ```
4. No code change. The function already reads these keys. The next `alert-delivery-secure` invocation will deliver successfully to Teams + Slack.

**Result:** Future alerts deliver via Teams + Slack. SMS still fails ("No phone numbers configured") but `status='sent'` because of any-channel-succeeds semantic. The 13,857 backlog stays `'failed'` — separate cleanup decision.

### Tier B — Add SMS (≤1 hour)

5. Acquire a **Twilio account** (account SID, auth token, From number) — operator may already have Twilio for MFA (`TWILIO_PHONE_NUMBER` env var is referenced in CLAUDE.md for MFA)
6. Set three Supabase secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
7. Insert phone numbers into `intelligence_config`:
   ```sql
   INSERT INTO intelligence_config (key, value) VALUES
     ('sms_alert_numbers', '{"numbers": ["+1XXXXXXXXXX"]}');
   ```
8. No code change.

**Note on existing Twilio config (from CLAUDE.md):** the project already has `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` configured for MFA. The alert function reads `TWILIO_FROM_NUMBER` instead — **subtle env-var-name mismatch**. Either rename in code, alias the env var, or set both. This is a one-line discrepancy worth flagging before remediation.

### Tier C — Backlog cleanup (separate decision)

The 13,868 historical failed rows can be:
- Left in place as audit history (current state)
- Archived to a `alerts_archive` table
- Bulk-deleted (loss of forensic trail)
- Bulk-retried (would re-attempt all 13,868 alerts against the now-configured channels → massive notification spam)

**Bulk retry is the worst option.** The Tier A/B fix should NOT trigger re-processing of historical rows. The current schema doesn't accidentally re-process: only `status='pending'` rows get picked up by the email path, and `alert-delivery-secure` is direct-invoke only. So the backlog will remain `'failed'` after the fix unless someone explicitly retriggers it.

### Recommendation

**Tier A is the minimum safe fix.** It requires zero code change and restores Teams + Slack delivery for all future alerts. SMS can be added incrementally in Tier B once the Twilio env-var mismatch is reconciled.

### What the minimum fix does NOT solve

- The 13,868-row historical backlog stays as audit data
- The legacy `alert-delivery` (email) path remains effectively unused
- Per-tenant routing (per §4) — still global; not in scope for minimum fix
- Per-channel observability for partial failures (per §6) — not in scope
- Two-function topology cleanup — both functions stay independently deployed

---

## §8 — How do we test delivery without spamming real users?

Three approaches, ranked by safety:

### Approach 1 — Use a dedicated test webhook + test phone (SAFEST)

- Create a Teams channel called `#fortress-alerts-test` with its own webhook URL
- Create a Slack channel called `#fortress-alerts-test` with its own webhook URL
- Use a personal/operator-owned phone number for the SMS recipient
- Configure these BEFORE the real channels
- Run a single test invocation:
  ```bash
  curl -X POST .../functions/v1/alert-delivery-secure \
    -H 'Authorization: Bearer ...' \
    -d '{"priority":"p3","channels":["teams","slack","sms"],"incident_id":null,"recipients":{...}}'
  ```
- Verify Teams + Slack + SMS arrive
- Then swap `intelligence_config` to point at the real channels

**Test data isolation:** the test alert lands in real `alerts` table but with operator-controlled recipients. After verification, mark the test row `status='archived'` or similar.

### Approach 2 — Local test via webhook.site or similar (NO PRODUCTION SIDE-EFFECTS)

- Use https://webhook.site to get a temporary webhook URL that captures POST bodies
- Set `intelligence_config.teams_webhook_url` and `slack_webhook_url` to the webhook.site URLs
- Trigger a test alert
- Inspect the captured POST bodies on webhook.site to verify formatting
- No real users are notified
- Limitation: doesn't test SMS path; doesn't verify Teams/Slack's actual formatter rendering

### Approach 3 — Dry-run mode in code (REQUIRES CODE CHANGE — out of scope for "minimum fix")

- Add a `dryRun: boolean` flag to `SecureAlertPayload`
- When set, log the payload but skip the actual fetch/Twilio calls
- Out of scope per operator constraint ("no code"); listed for completeness

### Recommended test sequence (before Tier A goes live)

1. Configure webhook.site URLs in `intelligence_config` (Approach 2)
2. Trigger a single `alert-delivery-secure` invocation against a test signal
3. Verify the captured payload on webhook.site renders the expected Teams card / Slack blocks
4. Trigger a second invocation with the REAL test channels (Approach 1) — `#fortress-alerts-test` Teams/Slack channels + operator personal phone
5. Verify operator receives the test on all three channels
6. Swap `intelligence_config` to real production channels (Petronas oncall Teams/Slack, real oncall phone)
7. Trigger one more test with `priority='p3'` and explicit `incident_id=null` to send a non-alarming "delivery test" message
8. Wait 24h for any production-incident alert to fire naturally; verify delivery

**Backlog quarantine:** before any of the above, mark all 13,868 existing failed rows with a `do_not_retry: true` flag in their `response_json` (or rename the channel) — eliminate any chance an automated retry pass picks them up after the channels go live.

---

## §9 — Summary Verdict

| Question | Answer |
|---|---|
| 1. What function sends alerts? | **Two**: `alert-delivery` (legacy, email-only, never has work) and `alert-delivery-secure` (Teams + Slack + SMS, where the failures live) |
| 2. What env vars / settings are missing? | `intelligence_config.teams_webhook_url`, `slack_webhook_url`, `sms_alert_numbers` (all absent). Twilio env vars (`TWILIO_FROM_NUMBER` etc) unknown but never tested. |
| 3. Are all four channels supposed to be active? | Teams + Slack + SMS yes (per code intent + 100% of failed rows). Email = orphan legacy path. |
| 4. Tenant routing? | **None today.** Config is global. Per-tenant would be an architectural addition. |
| 5. Fallback path? | None. Each channel runs independently in parallel; no escalation if all fail. |
| 6. "Sent" semantics? | **Already correct** (any-channel-succeeds = sent). Per-channel partial-failure visibility is the gap. |
| 7. Minimum safe fix? | **Tier A: Insert two rows into `intelligence_config` (teams + slack webhooks).** Zero code change. Restores delivery for all future alerts. |
| 8. Test without spam? | Use webhook.site + dedicated test channels before swapping to production webhooks. Quarantine the 13,868-row backlog with a `do_not_retry` flag first. |

---

## §10 — Honest Limits

| Gap | What I couldn't determine |
|---|---|
| Twilio env var status | Whether `TWILIO_FROM_NUMBER` is currently set; the function never reaches the Twilio path so this is unverified |
| `RESEND_API_KEY` status | Similarly unverified |
| `incident-manager` / `ingest-signal` caller code | Whether they could pass `recipients.{teams_webhook,slack_webhook,sms_numbers}` per-invocation; haven't inspected |
| Tenant-routing intent | No documentation found indicating whether per-tenant routing was a planned future enhancement or never considered |
| Alert content validation | The Teams card / Slack blocks formatters might have stale links, branding, or placeholder values — un-tested since 2025-10-03 |

These are honest gaps, not blockers. The Tier A minimum fix doesn't depend on resolving them; they become relevant in Tier B and beyond.

---

## §11 — Constraints Honored

- Assessment only — no code, no configuration changes
- No remediation applied
- P1.4 fix complete + validated (separate task)
- W-MISSION Phase 1 GREEN (P1.1 + P1.3 × 2 + P1.4 all firing as designed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
