# WO-A — Canonical Create-Gate Specification

**Status:** Design spec, pre-implementation. Built from WO-B cleanup evidence (2026-07-04).
**Purpose:** One canonical creation path for signals and incidents that makes the entire class of defects behind the 411→41 cleanup *impossible at birth*, so the pipeline stops generating the noise the cleanup had to remove.

---

## 1. Why this exists

The 411-incident board was ~90% machine-generated noise. Every category traced to a **missing gate at creation**:

| Defect found | Root cause | Gate that prevents it |
|---|---|---|
| 348 `[PATTERN]` duplicates | **`check-incident-escalation:148`** re-creates an incident per run: links the signal via a separate `incident_signals` row so `incidents.signal_id` stays NULL (the partial-unique index never engages), and never sets `client_id` though it has `signal.client_id` in hand | Set signal_id + dedup key + owner-required |
| Ownerless incidents (null client/tenant) | writers insert directly with no owner | Owner derive-or-reject |
| Synthetic-client absorption | monitors route real signals to `is_test` clients | is_test never wins routing |
| Stale-at-birth (May event in July) | no event-time test | Recency gate |
| Irrelevant (Petronas repo, Nantes, Malaysia FSO) | entity-name match alone mints a row | Relevance gate (second factor) |
| Confabulated escalation, provenance lie | no actor stamp, no evidence minimum | Provenance + evidence gate |
| Escalation storm on ownerless row | auto-escalator loops on rows with no owner | Owner-before-escalation |

**Principle:** fix the writer, not the rows. A cleanup that runs while the cause is live is whack-a-mole. WO-A is the cause-fix; the 2.5 write-seam guard is the stopgap it makes permanent.

---

## 2. Architecture — one door, every actor

Every signal and incident — from monitors, agents, AEGIS, or humans — is created through **one canonical function**, never by direct `INSERT`.

- `create_signal(payload)` — canonical signal creation
- `create_incident(payload)` — canonical incident creation

Direct `.from('signals').insert()` / `.from('incidents').insert()` is prohibited outside these functions. (Enforcement: code review now; DB-level `REVOKE insert` + `SECURITY DEFINER` function later.)

This is the same discipline as the `open_incidents_v` canonical read view: **one query one truth** applied to writes. It is also the foundation of AEGIS's agency — the officer creates through the same door as everyone else, with his name on it.

---

## 3. The create-gate — ordered checks

Applied in order. Any REJECT stops creation and logs to a visible queue (never a silent drop).

### Gate 1 — OWNER (derive-or-reject)
- Resolve `client_id` → derive `tenant_id` server-side from the client FK.
- If no `client_id` OR client cannot be resolved → **REJECT**, log to `unrouted_signals`.
- `is_test` client + live signal → **REJECT** (the 2.5 guard, now canonical), log to `misrouted_signals`.
- **No ownerless row is ever created.** Kills: 348 pattern duplicates' ownerlessness, null-client incidents, the escalation storm.

### Gate 2 — RECENCY
- Every row carries `event_time` (actual time the underlying event occurred — extracted from body/source, not `created_at`). Use `event_time_basis` where it exists.
- Threshold is category-dependent:
  - breaking threat / active incident → hours–days
  - regulatory proceeding → weeks
  - persistent campaign → ongoing (no recency expiry)
- Stale-at-birth (event older than category threshold) → **created but flagged `non_alerting`**, never surfaced as current, never enters escalation.
- Kills: May-vessel-deaths, 2020-paste, stale copper-theft fragments surfacing as "current."

### Gate 3 — RELEVANCE (second-factor required)
- No promotion to incident without a tie to client **asset / geography / operational-impact**.
- Entity-name-adjacency alone is INSUFFICIENT. Requires a second factor:
  - named client asset, OR
  - in-region geography (client's operating corridor), OR
  - direct operational link
- Fail → signal may exist at low priority, but does **not** promote to incident.
- Kills: Petronas-repo (name only), Nantes/Jamaica (wrong geo), Malaysia FSO (not PECL Canada).

### Gate 4 — COST-WEIGHTED threshold
- The relevance/confidence bar is tuned by **cost-of-miss**, not a single global threshold.
- Expensive-to-miss (credential exposure on a real asset, threat to a principal, fatal incident at a *current* operation) → stays sensitive even at low confidence.
- Cheap-to-miss (distant wildfire, foreign protest) → filters aggressively.
- Design goal: **"make not-missing-what-matters cheap."**

### Gate 5 — DEDUP (idempotency)
- Every row carries a dedup key. Incident key includes `client_id` + event-cluster identity (NOT raw text similarity — that collapsed distinct typosquats).
- Before create: if an OPEN row with the same key exists → **update** it (bump count / `updated_at`), do not create a duplicate.
- Dedup is **entity/event-aware**, never prose-similarity (the WO-DEL lesson).
- Kills: check-incident-escalation's re-minting (it links via `incident_signals`, leaving `incidents.signal_id` NULL → the partial-unique index can't fire).

### Gate 6 — EVIDENCE minimum + PROVENANCE stamp
- Minimum evidence to become an **incident**: N corroborating signals OR explicit human confirmation. One signal = a signal, not an incident.
- Every row stamps: `created_by` (monitor name / `aegis` / user id), `source_id`, `event_time`, and — for AEGIS-initiated — session id + originating instruction.
- Confidence rendered as Admiralty grade / "cannot be judged," never a fabricated percentage.
- Timeline claims must be true: no `client confirmed: true` while `client_id` is null (the provenance lie).
- Kills: confabulated escalation, single-paste "escalation," the provenance lie.

---

## 4. Owner-before-escalation

The auto-escalator must **refuse to act on any row without a resolved owner**. Gate 1 already prevents ownerless creation; this is defense-in-depth so no legacy or edge path re-creates the p1→p1 storm.

---

## 5. Input queues WO-A consumes

- `misrouted_signals` (from 2.5 guard) → re-resolve each to the correct real client by asset/geography. **Dedup this queue** so persistent events (the 4 NE-BC fires) stop re-logging every 15 min.
- `unrouted_signals` (new, Gate 1) → rows with no resolvable client, for review.

---

## 6. Build sequence (each verified before the next)

1. `create_incident` with Gates 1, 5, 6 (owner, dedup, evidence/provenance) — the highest-leverage subset; stops the ownerless writer and duplicate creation.
2. Route **`check-incident-escalation`** (the ownerless writer — all three defects) + **`ai-decision-engine`** (the clean template — proves the door doesn't regress a good writer) through it. Prove: no new ownerless or duplicate incident across two run cycles.

> **WRITER-IDENTITY CORRECTION (2026-07-05, from Step-1 ground truth):** the ownerless `[PATTERN]`-incident writer is **`check-incident-escalation:148`**, NOT `detect-threat-patterns`. `detect-threat-patterns` correctly does NOT create incidents (it writes pattern *signals* with `client_id` set, and comments "Pattern signals must not auto-create incidents", line 195). Prod stamp evidence: `(null/unstamped)` writer class = 394 incidents / 360 ownerless / 394 no-provenance / 348 `[PATTERN]`; `ai-decision-engine` = 79 / 3 / 0 / 0. `check-incident-escalation` is also the source of the "client confirmed: true / client_id null" provenance lie (it reads `signal.client_id` for priority + timeline at line 126/160 but never writes it to the incident).
3. Add Gates 2, 3, 4 (recency, relevance, cost-weighted).
4. `create_signal` with the same gates; route the ~13 direct-fetch monitors through it (the consolidation retrofit).
5. Two-client sentinel test: synthetic Client A / Client B, run monitors, assert zero cross-client leakage and zero ownerless/duplicate creation.

## 7. Acceptance — nothing done until it FAILS correctly

Per doctrine: a gate that has never fired is decoration. WO-A is proven when we can show, with pasted output:
- a rejected ownerless creation,
- a deduped (updated-not-created) duplicate,
- a stale-at-birth row flagged non-alerting,
- a relevance-failed signal that did NOT promote,
- a misroute re-resolved to the right client.

Five receipts, one per gate. Then WO-A is done — and the 411 can never come back.

---

## Doctrine references (from VISION / ledger)
- **Fix the writer before the rows.**
- **Events end, campaigns persist.**
- **One door, every actor** (AEGIS creates through the same path, with provenance).
- **Reject visibly, never drop silently.**
- **Make not-missing-what-matters cheap.**
- **A gate that never fires is decoration.**

---

## Fresh-head flags for tomorrow (recorded 2026-07-04, not changes — things to confirm at start)
- **`open_incidents_v` reference** — spec cites it as an existing canonical read view; confirm it exists (or fold its creation into WO-A) before leaning on the "same discipline" framing.
- **`event_time` availability** — `event_time_basis` exists only in some lineages (prod v174/v175 `ingest-signal` did NOT have it — that was the deploy fork). Gate 2 needs the event-time column actually present on `signals`/`incidents` in prod; verify/backfill scope is a Gate-2 prerequisite.
- **Enforcement staging** — "code review now, `REVOKE insert` + `SECURITY DEFINER` later" is correct; do NOT REVOKE until every writer is routed through the door (a premature REVOKE breaks all monitors). Sequence it as the LAST step after build-sequence #4.
- **Gate 6 `N` corroborating signals** — pick N per category with the cost-weighting (Gate 4); a single high-cost signal (credential exposure on a real asset) may warrant N=1 + human-confirm rather than a flat threshold.
