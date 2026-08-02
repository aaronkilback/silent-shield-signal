# WO-ALERT-BRIDGE-NULL-INCIDENT-01 — operator alert bridge is blind to null-incident alerts

**Logged:** 2026-08-02. **Status:** SCOPE — defect confirmed, fix HELD. **Priority:** HIGH (silent undeliverable path on the operator paging channel). **Defect family:** INNER-JOIN-on-nullable-FK doctrine (INC-ALERTS-BRIDGE precedent — 13,612 rows, incl. a dropped `interruption` Amber Alert benign only by fixture-routing luck).

## The defect
`operator_bridge_pending_alerts(p_since, p_since_id)` — the RPC that feeds `alert-operator-bridge` (the operator email paging path) — is:
```sql
SELECT a.id, a.created_at, a.recipient, a.channel, i.title, i.severity_level, cl.name
FROM public.alerts a
JOIN public.incidents i ON i.id = a.incident_id      -- INNER JOIN
JOIN public.clients   cl ON cl.id = i.client_id       -- INNER JOIN
WHERE a.status='pending' AND a.sent_at IS NULL
  AND a.tier IN ('notification','interruption')
  AND (a.created_at, a.id) > (p_since, p_since_id)
  AND cl.status='active' AND cl.name NOT LIKE '\_%'
ORDER BY a.created_at ASC, a.id ASC LIMIT 100;
```
**Any pageable alert with `incident_id IS NULL` is silently invisible to the bridge** — the INNER JOIN drops it. It is never delivered, never counted, never surfaced. This is not a quiet period; it is a **silent undeliverable path**.

## Evidence (2026-08-02)
In the 25-day window since the bridge watermark (2026-07-08), of **12** pageable-tier alerts:
- **10 had `incident_id IS NULL`** (8 `superseded`, 2 `sent`). The 2 that were delivered went via a **different** path *because* the bridge's INNER JOIN could not see them.
- 2 were `interruption`s for the `_benchmark_bcch` test client (excluded by `NOT LIKE '\_%'`).
- **0** alerts were deliverable by the bridge.

So the bridge's static watermark (and its `last_notified_id` still at the zero sentinel — it has **never delivered via itself**) partly reflects genuine quiet, but is **also** masking this structural blindness: 83% of the window's pageable alerts were unreachable to it by construction. A future **real-client** pageable alert with a null incident FK would be silently undeliverable.

## Why alerts have null incident_id
Alerts are not always incident-bound — broadcast / public-safety / signal-direct / system alerts can carry `incident_id IS NULL` legitimately. The bridge assumes every pageable alert is incident-bound; that assumption is false, and the failure is silent (drop, not error).

## Fix (when authorized — do not build)
1. **LEFT JOIN incidents/clients + explicit null handling** in `operator_bridge_pending_alerts`: a null-incident pageable alert must still be selected (fall back to `alerts.recipient`/`alerts.title`/`alerts.client_id` if present; route to a default operator recipient if truly clientless). Never let the join silently drop a pageable tier.
2. **Self-report undelivered** (nullable-FK doctrine): the bridge (or a probe) must emit a finding when a `notification`/`interruption` alert is `pending` but excluded from delivery for ANY reason (null FK, inactive client, underscore client) — a pageable tier that cannot be paged is a finding, not silence.
3. Pairs with the WO-REVERSE-PHANTOM-PROBE-01 follow-up: the bridge has never delivered via itself, so the Resend send path is also unverified — fix the join AND prove one real delivery.

## Cross-reference
- INNER-JOIN-on-nullable-FK doctrine (memory) — "close the leak + make it scream BEFORE cleaning the puddle."
- INC-ALERTS-BRIDGE (the 13,612-row precedent) — same pattern, delivery-class query on a nullable FK.
- WO-REVERSE-PHANTOM-PROBE-01 — where this bridge was first flagged (idle-not-failing, but unconfirmed + this leak).
