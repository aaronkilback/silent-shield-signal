# WO-SUBSET-RULE-DEFECT — checks evaluated over a subset instead of their full population

**Status:** LOGGED (do not start). Candidate for a standing rule.
**Opened:** 2026-08-31 (operator observation, WO-SONAR-CREDENTIAL).

## The pattern (three instances in one week — not coincidence)
1. **drift.mjs** scoped to the **orphan set only** (deployed⊄repo), so it never saw **content drift**
   (repo `_shared` ahead of deployed) — the exact class that hid the stale ai-gateway. (WO-SCANNER-DEPLOY-DRIFT)
2. **Gate 2** (corroboration) tested a finding against a **title derived from the same capture** — the
   population under test excluded the thing that would have failed it. (WO-EXPOSURE-CORROBORATION / WO-GATE2-NONLEGAL)
3. **sonar-caller scan** swept the **pre-fix subset** of importers, missing `monitor-travel-risks`
   (a sonar caller deployed the same day but before the fix commit). (WO-SCANNER-AI-GATEWAY-STALE)

Common failure: the check's **aperture was narrower than the rule's domain**, so it reported "clean" over
the part it could see while the uncovered part was where the defect lived. A correct rule + a
partially-blind checker reads as a false pass — worse than no checker, because it manufactures confidence.

## Proposed standing rule (draft — for operator ratification, NOT yet adopted)
**Before writing any guard/detector/matcher, define its population explicitly and prove the checker's
aperture covers the whole of it.** Concretely:
- State the population the rule ranges over (all deployed functions, ALL locations of a finding, ALL
  importers regardless of deploy date — not a convenient subset).
- Show the check evaluates every member, or **name the excluded members and why** (a declared,
  logged exclusion — never a silent narrowing).
- A partially-blind checker must **fail loud / report its own coverage**, never emit a bare "clean."

This is the checker-aperture twin of the existing memory `[[feedback_check_must_see_whole_of_its_rule]]`
and `[[feedback_negative_finding_needs_complete_search]]`. If ratified, promote from these memories into a
CLAUDE.md standing rule with the three-instance provenance above.

## Do NOT (per ruling)
Do not start implementing fixes to the three checks here, and do not author the standing rule text as
adopted — this file only records the pattern for the next review.
