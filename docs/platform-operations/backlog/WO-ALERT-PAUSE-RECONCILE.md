# WO-ALERT-PAUSE-RECONCILE — do three watchdog alert findings describe the same paused rows?

**Status:** report only (Step 1 in progress 2026-08-31). **Do NOT:** dispatch anything, re-enable the
delivery cron, or touch any alert row.

## The trigger
The watchdog panel reports three findings that appear to describe the same rows:
- **CRITICAL:** 3 interruption-tier alerts undispatched >15min (oldest 5260min).
- **HIGH:** 2 notification-tier alerts undispatched >60min (oldest 9373min).
- **LOW:** Alert delivery PAUSED (deliberate) — 5 pageable alerts held, will drain on re-enable.

3 + 2 = 5. Establish whether these are the same five rows.

## Questions (Step 1)
1. List the undispatched alert rows: id, tier, created_at, client, current status.
2. List the rows the PAUSED finding counts.
3. Same set? Yes / no.
4. When was the pause enabled, by whom (if recoverable), and any record of why.
5. Does the undispatched-alert check read the pause state at all? Show the code. If it does not, that is the
   defect.

## The two outcomes
- **Same set →** not an alert failure. It is the watchdog raising a **deliberate operator action as CRITICAL
  for three days**, training the operator to ignore the alert that matters. Same class as
  **WO-SUBSET-RULE-DEFECT**: a check judging a condition without seeing the state that explains it.
- **NOT the same set →** alerts meant to page a human went undelivered for days. **Report immediately and
  stop** — that becomes the priority over the entire queue.

## Step 1 findings (2026-08-31) — SAME SET. Watchdog defect, not an alert failure.
1. **Undispatched rows (CRITICAL+HIGH):** exactly 5, all **Petronas Canada**, recipient
   `ak+petronas-launch@silentshieldsecurity.com`, status=pending, sent_at NULL:
   - interruption: `1c62b1ee` (5447m), `fc2de315` (5086m), `c23e8415` (4713m)
   - notification: `58e9b09e` (9560m), `0f8693d7` (9530m)
2. **PAUSED-finding rows:** the identical 5 (`in_paused_set=true` on exactly these; every other
   pending/superseded pageable row is false on both predicates).
3. **Same set? YES.** 3 interruption + 2 notification = the 5 held-by-pause alerts.
4. **Pause:** enabled **2026-08-25 14:59:25Z**, `paused_by=operator`, reason on record: *"Operator
   deliberately paused pending alert-pipeline sign-off — sends stay OFF until the operator is satisfied (INC
   alert-pipeline)."* `cron.job.active=false`.
5. **Does the undispatched check read the pause state? NO — the defect.** `is_cron_job_active` is called
   **exactly once** in system-watchdog (line 3127, the pause-aware INC-ALERT-DELIVERY probe that emits the
   LOW PAUSED finding). The **P1.4-PAGEABLE check (lines 4298-4382)** that emits the CRITICAL (interruption
   >15m) and HIGH (notification >60m) findings checks tier + `sent_at IS NULL` + age + excludes `unrouted:*`
   — and **never reads the pause.** So it raises a **deliberate operator pause as CRITICAL for ~6 days.**

**Verdict:** NOT an alert-delivery failure — the 5 pageable alerts are intentionally held and will drain on
re-enable. It is the **watchdog double-counting a deliberate operator action at CRITICAL** because the
pageable-SLA check is blind to the pause state that the PAUSED probe already sees. **Same class as
WO-SUBSET-RULE-DEFECT / Population-Before-Check:** a check judging a condition without seeing the state that
explains it. **Step 2 (not now):** the P1.4 pageable-SLA check must consult `is_cron_job_active` and
suppress/downgrade when paused (the PAUSED probe already covers those rows), OR the two checks unify so a
held-during-pause row is reported once, pause-aware. No alert row touched, no cron re-enabled, nothing
dispatched.

## Step 2 (2026-08-31) — ruling follow-ups (report only, nothing applied)

### Item 1 — the check fix (design, NOT applied): distinguishing held-by-pause from stuck-anyway
Distinguisher is **claim-eligibility**, using the delivery mechanism's OWN predicate (`claim_pending_email_alerts`):
- **Held-by-pause** = a row the claim RPC WOULD send on re-enable = `channel='email' AND status='pending' AND
  client_id NOT NULL AND a matching active+verified client_alert_recipient exists`. (= the LOW PAUSED set.)
- **Stuck-anyway** (must STILL fire P1.4 even while paused, the pause does not explain it): `status='sending'`
  past lease+idempotency-window (→ requires_reconciliation, never sent), recipient `unrouted:*`/no verified
  recipient, `client_id NULL` (INC-ALERTS-BRIDGE null-FK). None of these drain on re-enable.
- **Fix:** when `is_cron_job_active('alert-delivery-v2-email')=false`, P1.4 subtracts the claim-eligible
  (held-by-pause) rows from its CRITICAL/HIGH count; a non-empty remainder (stuck-anyway) still fires. Ties
  the watchdog's suppression to what the pipeline would actually deliver, so it can never mute a genuinely
  stuck row. Do not apply until approved.

### Item 2 — the pause (report only, do not act)
- **What the 5 held alerts are** (content in `alerts.response_json.body`; incident_id NULL is normal — signal/
  agent-derived, not incident-linked): 2 **notification** = CISA CVE/**intrusion advisories** (HIGH/P1, "asset
  match: not confirmed — advisory"); **3 interruption** = **"Agent TIER2-REVIEW proposes raising [NAAD yellow
  severe-thunderstorm warning] from medium to high"** — INTERNAL AGENT severity-change proposals, minted at
  **interruption (pageable) tier** to the Petronas recipient. Interruption tier for an internal proposal about
  a yellow thunderstorm warning is **mis-tiered** (separate defect worth its own WO).
- **Sign-off record:** NONE. No doc records what "alert-pipeline sign-off" was blocking on (only this WO
  mentions "alert-pipeline"). Stated plainly per ruling.
- **Re-enable behavior:** `claim_pending_email_alerts` claims ANY `status='pending'` email alert with a verified
  recipient **with NO age filter** and **no cross-alert dedup** (per-alert idempotency only guards re-sends of
  `sending` rows). So on re-enable **all 5 drain at once** to `ak+petronas-launch@` — including 3 interruption
  pages about a ~week-old severe-thunderstorm agent-proposal. Nothing age-suppresses a stale interruption alert
  on the way out. → argues for **selective drain / age-suppression**, not a blind re-enable. Operator's call.
