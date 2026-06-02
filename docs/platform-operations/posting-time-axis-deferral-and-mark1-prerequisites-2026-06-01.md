# Posting-Time Axis — Deferral & Mark I Re-Entry Prerequisites

**Date:** 2026-06-01
**Status:** **DEFERRED, not failed.** Do not attempt to rescue posting-time during the current Mark II campaign.
**Decision owner:** operator (accepted 2026-06-01).
**Evidence:** read-only prod probes (project `kpuqukppbmwebiptqmog`, tenant `feff5c44`), this session.

---

## Why deferred (evidence)

1. **Grounded person-entity signals are news mentions, not actor posts.** The persons with ≥10
   actor-time-grounded signals are public figures (Carney, Danielle Smith, David Eby) surfaced via
   `google_news_api` — `event_date` = article *publication* time (media behavior), not actor posting.
2. **Actor-authored social signals are not grounded.** Social monitors write cosmetic/copied
   `event_date` (G-9), so `grounded ∩ actor-authored ≈ empty` (`grounded_social ≈ 0`).
3. **The monitored actors have no usable footprint.** The 12 `active_monitoring_enabled` person POIs
   (incl. Mark Fitzgerald, Nick Vashouk, Tzeporah Berman, Anne Spice) have **0–2 grounded signals
   each** — far below the axis's ≥10 floor; the highest-value POIs have **zero** signals.

Conclusion (accepted): posting-time is **not validatable on the current corpus.** The G-9 grounding
fix (commit `eb3eaf09`) was correct and necessary, but cannot rescue posting-time — the data isn't there.

> **Related finding (Fork A):** source-class carries the *same* shared-infrastructure confound —
> 96% of entities are `{news}` or `{news+social}`, so source-class overlap is moderate-to-strong for
> nearly all pairs (spurious). Both behavioral axes are corpus-type artifacts. The prerequisites below
> therefore apply to *trustworthy correlation generally*, not posting-time alone.

---

## Mark I re-entry prerequisites (ALL required before posting-time is reconsidered)

| # | Prerequisite | What it means | Current state |
|---|---|---|---|
| 1 | **Actor-authored signals** | Signals that are the actor's OWN posts (their account/handle), not third-party news mentions of them | ❌ corpus is overwhelmingly news mentions |
| 2 | **Reliable event timestamps** | `event_date` = the actor's real post time, grounded; no cosmetic-midnight, no copied-from-created, **no future dates** | ❌ social `event_date` cosmetic; future-dated values (2027-01-01) present |
| 3 | **Social ingestion restoration** | Re-enable actor-post collection (X / `monitor-x-single`, social monitors) per the Phase X-1 controls; `monitor-twitter` is retired | ❌ X monitoring retired (budget); social thin |
| 4 | **Writer fixes** | Social monitors must write the real upstream post timestamp into `event_date`; the T-1 `temporal_grounding` writer must populate the column (today 100% `'unknown'`); add an `event_date ≤ now()` guard | ❌ not done |
| 5 | **Sufficient actor coverage** | Monitored POIs must each accumulate **≥10 grounded actor-authored signals** (the axis floor) | ❌ monitored POIs at 0–2 |

---

## Re-entry test (deterministic, read-only)

Posting-time may be reconsidered **only when**: re-running the actor-entity probe shows **≥2 monitored
person actors in a tenant, each with ≥10 actor-time-grounded, actor-authored signals** (event_date =
post time, sourced from the actor's own account). Until that test passes on real data, posting-time
stays deferred and must not be deployed or validated.

---

## What this is NOT

- NOT a statement that posting-time is a bad design — it is a correct design for actor-authored data.
- NOT a failure — it is a corpus/collection gap (Mark I), deferred pending the prerequisites above.
- NOT a Mark II blocker to fix now — the Mark II campaign proceeds on other evidence (see the Fork A
  finding for why source-class is also confounded, which reshapes what "other evidence" can be).
