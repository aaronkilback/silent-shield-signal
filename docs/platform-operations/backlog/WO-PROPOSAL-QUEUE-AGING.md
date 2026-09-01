# WO-PROPOSAL-QUEUE-AGING — a growing proposal queue that tells no one

**Status:** LOGGED. **Opened:** 2026-09-01. Sibling of the alert-pause defect (a queue that grows silently).

**The finding underneath the whole thread:** 82 defensible severity-correction proposals from TIER2-REVIEW
accumulated over five days (08-23 → 08-28) and then sat **unseen for a week**. Two independent causes:
1. **The queue was unreadable** — `agent_actions_awaiting_approval` had no authenticated SELECT, so the UI
   rendered a false "inbox zero" (WO-QUEUE-VIEW-PERMISSION, now fixed).
2. **Nothing ages or surfaces a growing propose-tier backlog.** There is no age/volume alarm on
   `agent_actions.status='awaiting_approval'`. A proposal that is never actioned just accumulates; a burst
   from one agent (82 in 5 days) produced zero operator signal.

The read is fixed. **The aging is not.** A queue that grows without telling anyone is the same failure class as
the alert pause — invisible accumulation of things that need a human. Scope: an age/volume probe on the
propose-tier queue (oldest-awaiting age, count trend, per-agent concentration) that surfaces to the operator
BEFORE the pile is a week old — consequence-banded, not one-notification-per-proposal (attention doctrine).
Also relevant: expired-condition proposals (a severity upgrade on a passed weather event) should decay/auto-
close with a recorded reason, not sit as live awaiting-approval — the age-suppression problem in this queue.
