# INC-ALERT-DELIVERY-2026-07-29

**Status:** REMEDIATION SHIPPED + code-verified live 2026-07-29 (first email ever sent; awaiting operator inbox confirmation to flip to verified-live). **Severity:** CRITICAL.
**Trigger:** neural-map finding — ~1000+ undispatched alerts, oldest ~298 days. **No bulk-dispatch of aged alerts** (per map guidance) — nothing dispatched during this investigation.

## Headline

**Email alert delivery has NEVER worked** — 0 sent, 0 attempted across **14,029 email alerts over ~298 days**. The only channel that has ever delivered is `secure_messaging` (13 alerts, last **2026-06-19**, 40 days ago). Alert delivery is a **fourth pillar-grade real-vs-aspirational finding** — silently non-functional for the platform's primary outbound notification channel. The watchdog/neural-map surfaced it.

## (a) Last confirmed delivery, per channel

| Channel | Ever sent | Last delivery |
|---|---|---|
| `email` | **0 / 14,029** (0 ever attempted) | **NEVER** |
| `secure_messaging` | 13 | 2026-06-19 00:07 |
| Slack / SMS | 0 (no alerts of these channels present) | never |

## (b) Cron + credentials

- **Cron EXISTS:** `alert-delivery-v2-email @ 4,19,34,49 * * * *` (every 15 min) → `POST /functions/v1/alert-delivery` with an internal-secret header. `get_alert_delivery_internal_secret()` exists.
- **NO cron_job_registry entry** and **NO heartbeat ever** — the function writes no heartbeat, so it has been a **monitoring blind spot** (the watchdog cron-alignment never tracked it; nothing ever alerted that delivery was silent).
- **A verified recipient EXISTS:** exactly 1 row in `client_alert_recipients` — `ak+petronas-launch@silentshieldsecurity.com`, verified, active, client = Petronas Canada. So credentials/recipient are not the blocker for Petronas.
- **The function runs but claims nothing.** It drains only email via the RPC `claim_pending_email_alerts`, which claims an alert ONLY if: `channel='email'` AND `tier IN (notification,interruption)` AND **`incident_id IS NOT NULL`** AND `EXISTS(incidents i JOIN client_alert_recipients r ON r.client_id=i.client_id WHERE i.id=alert.incident_id AND r.verified_at IS NOT NULL AND lower(r.email)=lower(alert.recipient))`.

## (c) Composition of the backlog

Of 14,029 email alerts:
- **13,609 have no incident link** — the vast majority are **`log`-tier** (record-only; correctly NOT dispatched — log tier is not a notification).
- **36 pending, no incident** → structurally unclaimable.
- **10 pending, incident-linked** (the actual pageable backlog):
  - **2 `interruption`** — real province-wide public alerts: "Critical Civil Emergency — Believed to be traveling through northern…" (19d) + "Critical Amber Alert — All of British Columbia" (7d). `recipient='unrouted:no-verified-recipient'` → no verified recipient (these are NOT client-specific; **fixture/province-origin**). Correctly not delivered; they are the operator's "2 unrouted placeholders."
  - **8 `notification`** — real recipient (`ak+petronas-launch@…`, verified) but their `incident_id` points to **deleted/superseded incidents** (LEFT JOIN resolves to "(no incident)"), so the claim RPC's `EXISTS(... JOIN incidents ...)` fails → never claimed → `attempt_count=0`.

## Root cause

The delivery claim is an **INNER-JOIN-on-nullable/dangling-FK** (the pattern already ratified as a doctrine after auto_approve #213 and INC-ALERTS-BRIDGE #223): a pageable alert is deliverable ONLY through a live `incident → client → verified recipient` chain. Any alert that (a) has no incident, (b) points to a deleted/superseded incident, or (c) has no verified recipient for its incident's client is **silently undeliverable**. Because email has never once satisfied that chain end-to-end, **0 emails have ever sent.** The absence of a heartbeat meant this was invisible for ~10 months.

## Remediation proposal (HELD for ruling)

1. **Decouple recipient resolution from the incident FK.** A pageable alert should carry/resolve its recipient independently (alert already has a `recipient` column). Deliver when `recipient` is a verified, active `client_alert_recipients.email` — regardless of whether the incident still exists. Keep the incident link as context, not as the join gate. (LEFT JOIN + IS NOT NULL guard, or resolve recipient at emit-time and store it.)
2. **Add a heartbeat** to `alert-delivery` (`recordHeartbeat`) + a `cron_job_registry` entry, so silent delivery failure is a watchdog finding, not a 10-month blind spot. Add a Sentinel/watchdog probe: "pageable alert pending > Nh with a verified recipient = delivery defect."
3. **Reconcile the 8 notification alerts** (dead incident FK, real recipient) — re-point or re-resolve recipient, then a controlled (non-bulk) dispatch of only the fresh, real, verified ones. **Aged alerts are NOT auto-dispatched** (map guidance); disposition per age.
4. **The 2 interruption placeholders close as fixture/province-origin** once the refuse-to-emit generator patch ships (INC item 2).

## Ledger

Alert delivery silently dead ~10 months (email: 0 ever sent) = **fourth pillar-grade real-vs-aspirational finding** (with confidence-sparsity, learning-loop, fleet-idle). The map surfaced it; the incident FK-join was the mechanism; the missing heartbeat was why it stayed invisible.

---

## Related neural-map triage (items 2–5, 2026-07-29)

**Item 2 — refuse-to-emit (SHIPPED).** `resolveAlertEmission` (`_shared/alert-tier.ts`) now gates both emit paths (`ai-decision-engine`, `ingest-signal`): a delivery-tier alert with no verified recipient OR fixture/benchmark origin is REFUSED (logged to `alert_emission_refusals`), never materialized as an unroutable placeholder. The 2 province-wide `interruption` placeholders closed as fixture/province-origin. Quarantine now covers alerting, not just retrieval.

**Item 3 — stuck-running (RESOLVED).** 95 job-worker `running` rows (4 on 07-27, 91 on 07-28, **0 on 07-29**). Not a live defect: job-worker is healthy (2044 succeeded/48h, last success 07-29 16:54). They postdate the single-flight lease fix, but that's expected — single-flight prevents concurrency, not stuck heartbeats from platform-kills. **Extended the reap-on-start guard to job-worker** (it only covered synthesizer); its next tick reaped all 95 → 0 stuck. Synthesizer: 0 stuck (guard working).

**Item 4 — instagram annotation (SHIPPED).** `monitor-instagram-2h` added to the watchdog KNOWN-LIMITATION/deferred set (Instagram keyword-CSE deferral, social audit 2026-07-15, actor-list successor) — same low/known treatment as social-unified.

**Item 5 — tier-2 review + fleet routing (evidence, HELD).** review-signal-agent is a SINGLE generic `TIER2-REVIEW` agent — it does NOT match `ai_agents.specialty` and does NOT route to the 42-agent fleet. It DOES fire for the [0.60,0.75) band (composite ≥ 0.60), reviewing **90.9%** of composite-bearing band signals (n=88 pre-3b; n=9 post-3b at 66.7%). **The "44% gap" is a confidence-sparsity artifact:** pre-Monday, most signals had null `composite_confidence` → never reached the ≥0.60 trigger → invisible to the reviewer. Post-3b (composite ~100% populated) the band is visible; the reviewer works. The fleet-dormant (8/42) is a SEPARATE design gap — there is no dynamic-specialty fan-out to the fleet (only 1-agent-per-incident assignment via ai-decision-engine), not a broken router. HELD.
