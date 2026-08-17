# WO-CLIENT-ONBOARDING-KILBACKS-01 — Kilbacks is an un-onboarded client, not a writer defect

**Status:** OPEN — belongs with the ARCHETYPE + CONFIG lane, NOT the attribution-writer lane. 2026-08-17.

## The finding
**Kilbacks has 1,523 signals and ZERO authoritative attribution, ever.** Its executive brief has never been anything but `insufficient_data`. This is not a defect of the missing attribution writer — it is a **client nobody has onboarded**. Even a perfect sweep writer would produce little of value for Kilbacks, because the inputs are wrong at the source:
- Kilbacks carries the short-keyword fabrication signature documented in CLAUDE.md (`cabin`→"cabin crew", `home`→"homeless") — its `monitoring_keywords` are generic short tokens that mint fabricated matches. So most of the 1,523 are likely junk, born-quarantine candidates, not real client intelligence.
- Attributing 1,523 fabricated-match signals would be worse than leaving them unattributed — it would render noise as verified client truth. **Onboarding (archetype + real keywords + geo/config) must precede any attribution of Kilbacks' backlog.**

## Why it belongs in the archetype/config lane
The fix is the same work as the venue-security spine / archetype taxonomy population path: pick Kilbacks' archetype (principal-protection / family, given the entity shape), replace generic short keywords with distinctive anchored ones (the deterministic-matcher token-boundary discipline retires the short-keyword hazard), set geo/config, THEN let the sweep attribute a clean stream.
- Sequencing: **do NOT include Kilbacks' 1,523 in the first attribution sweep.** Onboard first (this WO), then sweep the clean forward stream. Retroactively attributing the fabricated backlog is explicitly out of scope.

Cross-ref: archetype taxonomies (energy / venue_security / principal_protection), `docs/platform-operations/archetypes/venue-security-spine.md`, the deterministic matcher short-keyword retirement (WO-GATE-KEYWORD-PRESCORE-01), [[WO-ATTRIBUTION-WRITER-MISSING-01]] (which must EXCLUDE Kilbacks' backlog until this lands). NOT a blocker on the writer for the onboarded clients (PECL, BC Place).
