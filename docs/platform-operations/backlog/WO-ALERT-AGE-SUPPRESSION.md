# WO-ALERT-AGE-SUPPRESSION — a resumed pause dumps every held row regardless of age

**Status:** LOGGED, do not build. **Opened:** 2026-08-31 (WO-ALERT-PAUSE-RECONCILE Step 2 ruling #6).

`claim_pending_email_alerts` claims ANY `status='pending'` email alert with a verified recipient **with no
age filter** and **no cross-alert dedup** (per-alert idempotency only guards re-sends of `sending` rows). So
re-enabling a paused delivery cron **drains every held row at once**, including interruption-tier pages about
week-old conditions. An interruption page about a stale condition is wrong on arrival.

**Needs (later):** an age rule at drain time — beyond a tier-specific staleness horizon, a held pageable alert
should not auto-send on resume (route to reconciliation / operator review instead). Not now.
