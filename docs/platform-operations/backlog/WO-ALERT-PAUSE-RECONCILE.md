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
