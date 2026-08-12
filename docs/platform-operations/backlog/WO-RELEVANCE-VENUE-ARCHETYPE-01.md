# WO-RELEVANCE-VENUE-ARCHETYPE-01 — Relevance scorer is wrong in both directions for a venue client

**Status:** LOGGED, not started (operator, 2026-08-12).
**Scope:** the relevance scorer that populates `signals.relevance_score`, as it applies to a **venue** client archetype (BC Place). NOT the attribution writer, NOT the D6 eventhood gate.
**Provenance:** surfaced during BC Place re-attribution STEP 3. Evidence is the ≥0.60 MAIN-tier set for BC Place, window 2026-07-13→08-13 (the demo window). MAIN tier = `relevance_score >= REL_MAIN (0.60)` in `generate-executive-report` (line 462), which alone feeds the exec flash, client issues, incidents, risk table, and action items.

## The finding: the scorer is wrong in BOTH directions

Broader than sports. Three defects in the **same** MAIN-tier set:

1. **Event outcome over-ranks everything.** `"Win over BC Lions"` (rel **0.8**, high) — a CFL box score ("Edmonton Elks 19-17 over BC Lions, 5-1 record") — is the **single highest-relevance signal in the entire window**. It would lead the brief.

2. **Change-of-control under-ranks.** Two venue-**sale** stories rank *below* the game result:
   - `"Interest in purchasing B.C. Place"` (rel 0.7) — Doman bid for the venue.
   - `"BC Lions emerge as contender to buy BC Place"` (rel 0.6).
   A change of control at the venue is the **most consequential** signal in the window for a venue client — ownership, control, and tenancy changes must outrank event outcomes. The current scorer inverts that.

3. **Generic wire reaches MAIN with no client nexus.** `"Mitigation Actions for Exploitation of Vulnerable Routers"` (rel **0.7**) reached MAIN with **no BC Place nexus**. The deterministic matcher correctly attributed it `none`; relevance did not demote it. (It only stays out of the brief because attribution=none filters it — but the *relevance* score is wrong.)

**Restatement of the design requirement (operator):** for a venue client, the relevance ordering must be, high→low: change of control / tenancy / ownership at the venue → security incidents at the venue during its events → operational/regulatory → **event outcomes (scores/results) last**. Generic wire with no venue nexus must not reach MAIN on relevance alone.

## Acceptance criterion (single)

Re-scored against the same BC Place demo window, the two venue-sale stories rank **above** `"Win over BC Lions"`, and no signal the matcher attributes `none` scores `>= REL_MAIN`. (One acceptance test, one problem — do not bundle the D6 eventhood work or the attribution writer here.)

## Explicitly out of scope
- Eventhood / non-event classification — that is D6 (`incident-creation-gate.ts`), a separate order.
- Attribution correctness — the writer is proven; a tenant's team IS the venue's business (attribution = whose, relevance = whether).
- Do NOT re-run the sports heuristic (41/53) — it was diagnostic; the diagnosis is made.
