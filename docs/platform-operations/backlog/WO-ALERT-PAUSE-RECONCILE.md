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
