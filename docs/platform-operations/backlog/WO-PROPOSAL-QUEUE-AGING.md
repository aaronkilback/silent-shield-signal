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

## Update 2026-09-07 — the queue was not ignored, it was UNVIEWABLE (two independent failures)

Both surfaces that carry propose-tier agent output rendered a **FAILED read as a clean empty state**, so the
output was invisible — not deprioritized. TWO independent defects, one disguise:
1. **`agent_actions_awaiting_approval`** — permission denial (unreadable view / no authenticated grant) →
   false "inbox zero." Fixed by WO-QUEUE-VIEW-PERMISSION.
2. **`monitoring_proposals`** — a **TDZ crash** in `MonitoringProposals.fetchProposals` (a local `const
   clientIds` shadowed the outer `useTenantScopedClientIds()` value, throwing `Cannot access 'clientIds'
   before initialization` **before the request was ever sent**) → the page rendered **"No pending monitoring
   proposals" over a JavaScript crash on every load since 2026-06-07** (`c83d38965`). Fixed 2026-09-07 (rename
   → `proposalClientIds`, deployed on merge `7674aebb`); surfaced only because the false-zero AsyncListState
   fix (`ad46e653`) rendered the error instead of swallowing it. Lint gap that should have caught it in June:
   **WO-LINT-NOT-ENFORCED**.

The content was substantive the whole time — e.g. a **protest campaign against Petronas** and a **ransomware
threat tied to a named energy-sector entity**, each with agent reasoning + confidence — landing in a page that
crashed on load for ~3 months. **"Silent queue" was the wrong mental model twice over: the queue was
producing; the window onto it was broken.** Both failures share the false-empty signature the AsyncListState
work exists to kill.

## Aging report 2026-09-07 (feff5c44 / Silent Shield Operations — report only, do NOT act)

Ground truth for this tenant's `monitoring_proposals`:
- **786 pending** (924 total for the tenant). Across all tenants: 1058 pending / 93 applied / 37 rejected /
  11 superseded.
- **778 of 786 pending (99%) are PAST their own `expires_at`.** Only **8** are still valid. 0 have no expiry
  set.
- **Oldest pending: 112 days. Average pending age: 73 days.** 778 older than 7d, **701 older than 30d**,
  **276 older than 90d**.
- **What happens to an expired proposal: NOTHING.** There is no `'expired'` status anywhere in the table
  (only pending / applied / rejected / superseded); nothing reads `expires_at` to transition, decay, or hide
  a passed proposal. `expires_at` is written but **never enforced** — an expired proposal sits as live
  `pending` indefinitely. This is the age-suppression problem this WO named, now quantified.

**Verdict (matches the operator's framing):** most of the queue **has aged out**. It needs an **expiry
policy** — enforce `expires_at` (auto-close/decay to an `'expired'` state with a recorded reason, and
suppress expired items from the operator's live queue) — **before** it needs manual triage. Asking a human to
review 786 items, 99% of which reference conditions that have already passed, is the wrong ask. Pair with the
age/volume probe already scoped above so a *fresh* backlog surfaces while an *aged* one auto-decays.

**Note — never-merged-to-main:** this WO was authored on `ad1ee060` (branch `fix/wo-entity-mention-
contamination`) and was **not on `origin/main`** until this update — it existed in git history but not in the
canonical backlog. Brought to main 2026-09-07 with the above. Sibling of the Deployed-Not-Committed class: a
WO written but never landed is a promise no one can see (companion check for the backlog itself).
