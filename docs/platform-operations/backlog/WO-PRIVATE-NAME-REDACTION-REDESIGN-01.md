# WO-PRIVATE-NAME-REDACTION-REDESIGN-01 — Redesign private-name redaction (do NOT patch the lexicon)

**Status:** LOGGED, not started. Awaiting operator prioritization.
**Class:** wrong-control redesign — a redaction that decides by "is this first name common" fails both ways and cannot be fixed by extending the list.
**Provenance:** CRT brief finding #3 (2026-08-13). `scrubPrivateIndividualNames` (`generate-executive-report/index.ts:100`) rendered *"the planned induction of a private individual and Travis Lulay into the BC Lions Wall of Fame"* — one Wall-of-Fame inductee redacted, one kept, sentence broken.

## What the function is for
Redact the personal names of **private individuals** from client-facing narrative prose (executive summary, awareness synthesis, incident titles/rationale), replacing them with "a private individual" / "a local resident" / "the individual". Public figures and public roles are meant to survive.

## What it protects against
**PIPEDA** exposure — naming an identifiable private person (a protester, a community member, a victim) in a distributed security intelligence brief with no lawful basis is a personal-information disclosure. This is a real legal control, not a style nit.

## Why the current design cannot be patched
Pass 2 (`index.ts:151-155`) redacts "Firstname Lastname" **only if `Firstname ∈ COMMON_GIVEN_NAMES`**. The decision hinges on a first-name lexicon, so it fails in both directions:
- A private person with an **uncommon** first name survives (under-redaction → PIPEDA exposure).
- A **public figure** with a **common** first name is scrubbed (over-redaction → broken, wrong prose — the Wall-of-Fame case).
Extending `COMMON_GIVEN_NAMES` only moves the boundary; it does not change the fact that the classifier is "is this first name common," which is not the question. **Do not patch the lexicon.**

## The redesign (scope)
1. **Entity-level classification, not a name lexicon.** Decide redaction on whether the *named entity* is a private individual vs a public figure, resolved against the **tenant entity graph** (is this a tracked public figure / org?) and/or a public-record signal — not on the first name.
2. **Public-record context exemption.** A name appearing in an inherently public context (a Hall/Wall-of-Fame induction, an elected office, a published byline, a court record) is not a PIPEDA exposure and must not be redacted, regardless of the name.
3. **Grammaticality preservation.** Redaction must not leave broken sentences ("a private individual and Travis Lulay"). Either redact the whole construct coherently or, if it cannot be done cleanly, drop the sentence — never emit mangled prose.
4. **Fail-closed on uncertainty** for the PIPEDA control: if an entity cannot be classified public, treat as private (redact) — but do #3 so the result is still grammatical.

## Interim risk (demo-visible)
Until redesigned, briefs **can carry broken sentences** from this scrubber. That is a demo-visible defect. **Flag it if it appears in any pre-redesign generation** (the CRT brief already showed one).

## Acceptance criterion (single)
Redaction decisions are made by entity classification with a public-record exemption, produce grammatical output in 100% of cases (no orphaned "a private individual and <Name>" constructs), and the PIPEDA control is provably fail-closed. The `COMMON_GIVEN_NAMES` lexicon is retired as the decision mechanism.
