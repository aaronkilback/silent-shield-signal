# FINDING — signal-side event duplication + severity divergence (2026-08-20)

**Type:** FINDING (logged, NOT a task). **Do not build without an operator ruling.**
**Class:** same defect family as pre-clustering exposure items — different pipeline.

## Observed instance (live, operator-surfaced)
The chat query "most recent signals across my clients" returned the **same real-world event twice**:

| Signal ID | Title | Outlet | Severity |
|---|---|---|---|
| `c0157ef9-294e-48d3-bbb6-670950dddcd9` | Funding for Eco Depot in Kitimat | Northern View | **Medium** |
| `fce7fef7-96a7-4d2b-a56a-ee0008809f66` | Eco Depot Funding | Terrace Standard | **High** |

One event (Kitimat receives $5M from LNG Canada for an Eco Depot), two outlets, **two independently
assigned severities that disagree.** Both surfaced to the client as separate findings.

## Diagnosis
- **Signals are one-row-per-source with per-row severity.** There is no event-level clustering and no
  severity reconciliation across sources reporting the same event. Two outlets covering one story become two
  signals, each scored on its own.
- This is **exactly the defect the exposure-item work already solved on the other pipeline**: subject-exposure
  items are clustered by event/subject and ranked by *consequence* with a single reconciled severity
  (`compareExposureItems`, the two-phase clusterer in `_shared/subject-retrieval.ts`). That machinery does not
  exist on the `signals` pipeline.

## Client impact
What a client sees in a brief: **two findings where there is one event, disagreeing about how serious it is.**
That erodes trust in both the count ("how many things are happening?") and the severity ("how bad is it?") —
the same signal-to-noise / attention cost the Three Resources doctrine targets.

## Why logged, not built
Same defect *family* (duplication + divergent per-source severity), different *pipeline* (signals vs.
exposure items). Porting event-clustering + severity reconciliation to the signal path is a real design task
with its own blast radius (dedup key, cross-source reconciliation rule, what a "cluster" surfaces to the feed
and to AEGIS). It is **recorded here as a known finding** so it is visible alongside the other pipeline-parity
gaps; it is **not scheduled** and must not be built without an explicit ruling.

## Pointer
- Solved-on-the-other-side reference: `supabase/functions/_shared/subject-retrieval.ts` (clusterer +
  `compareExposureItems` consequence ranking); exposure-item severity-from-content work (WO-ENTITY-DEDUP era).
- Signal pipeline entry: `ingest-signal` (per-source row creation), consumed by the signals feed + AEGIS.
