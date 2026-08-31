# WO-GATE-POPULATION-SCOPE — the corroboration gate marks breach locations as failures (false record)

**Status:** LOGGED (report only, do not fix). **Opened:** 2026-08-31 (item-2 gate-honoring regression).
**Third variant of the population defect — see [[WO-SUBSET-RULE-DEFECT]].**

## What happened
The corroboration gate (subject-name presence in a page's title/snippet) was applied to **HIBP breach
locations**, where subject-name matching is **meaningless** — the match is on the subject's *email*, and a
breach's description page never contains their name. The gate silently marked all **25** Kilback breach
locations as `gate_failed='gate1_subject'`, `corroborates=false`. When item-2 taught the renderer to count
only gate-passing locations, every real data breach would have rendered **"0 independent domains"** — caught
by reading the report as a client.

## What the render fix did and did NOT do
- **Fixed (today):** `srcCount`/`locList` exempt `data_breach` (`gateApplies=false`), so breaches count all
  their locations. The render is correct.
- **NOT fixed:** breach locations are **still written** with `gate_failed='gate1_subject'` — a **false
  record**. Any future consumer that reads `gate_failed`/`corroborates` (an analytics query, a probe, a
  learning pipeline) will draw the same wrong conclusion the renderer did. The render exemption is a patch at
  the read layer; the bad data persists.

## The question (report, then decide — do not fix now)
Two ways to correct the write:
1. **Skip the gate for `data_breach` at write time** — the gate simply does not run on populations it was not
   designed for (breach, and by the same logic environmental/coordinate anchors).
2. **A `not_applicable` state distinct from a failure** — `gate_failed` currently conflates "the gate ran and
   the page failed the name check" with "the gate does not apply here." A distinct `not_applicable` value
   (or a nullable "gate_scope" column) records the truth. **This is the same distinction as
   `not_assessed` vs `not_asserted`, one layer down** — did-not-apply vs applied-and-failed.

Recommendation to weigh when picked up: option 2 mirrors the epistemic discipline we just ratified in the
synthesis layer; option 1 is simpler but loses the record that the gate deliberately abstained. Confirm the
write source first (likely the corroboration backfill applying the gate over ALL existing locations, and/or
any path that runs `gateLocation` on breach rows).

## Pattern
Third instance this period of **a gate/rule applied to a population it was not designed for** — the domain of
the Population-Before-Check standing rule. Twin at the render layer of what Population-Before-Check governs at
the check layer: before applying a gate, prove its population is the one the gate was built for.

## Do NOT
Do not fix. Report only. Reference [[WO-SUBSET-RULE-DEFECT]] and the Population-Before-Check standing rule.
