# WO-ALERT-TIER-DISCIPLINE — internal agent proposals minted at interruption tier, addressed to a client

**Status:** report only, do not build. **Opened:** 2026-08-31 (WO-ALERT-PAUSE-RECONCILE Step 2 ruling #4).
Two defects in one alert: **wrong tier** (interruption/pageable for an internal proposal) + **wrong audience**
(client recipient for an internal operational message).

## The urgent question — ANSWERED FIRST (2026-08-31): nothing reached a client. No stop.
- Alerts of this shape ("Agent TIER2-REVIEW proposes raising [NAAD …] from medium to high") minted since
  live: **3** — all `tier=interruption`, all created **2026-08-27/28 (AFTER the 2026-08-25 pause)**, all
  `status=pending`, **delivered_total = 0.**
- Widened check — **everything ever delivered to a real client: 5 rows total, ALL notification-tier, ZERO
  internal-proposal shape, ZERO interruption-tier**, all to the `ak+petronas-launch@silentshieldsecurity.com`
  launch alias (2026-07-29 → 08-25). **No internal proposal and no interruption-tier page has ever reached
  Petronas.** Six days of *held* alerts, not weeks of *delivered* ones. Stop condition NOT triggered.

## To report on (Step 1, not yet done — do not build)
1. **What emits these** — the code path from an agent severity-change proposal to an `alerts` row.
2. **What sets `tier`** — and on what basis an internal proposal became `interruption`.
3. **What sets `recipient`** — why an internal proposal is addressed to a client recipient at all.
4. (done above) counts minted / delivered / to-client.

## Cross-refs
WO-ALERT-PAUSE-RECONCILE (parent) · the 3 rows are among the five being CANCELLED (ruling #2). Alert-tier
doctrine already partly in `_shared/alert-tier.ts`.
