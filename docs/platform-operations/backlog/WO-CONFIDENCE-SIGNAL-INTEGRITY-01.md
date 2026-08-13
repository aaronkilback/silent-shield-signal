# WO-CONFIDENCE-SIGNAL-INTEGRITY-01 — Decorative confidence/citation signals (CLOSED, for the record)

**Status:** CLOSED 2026-08-13. Logged because the *class* is the finding, not the individual fixes.
**Class:** the system asserting how sure it is — a confidence, reliability, verification count, or citation marker — with **nothing computing it**. Decorative certainty. The product's differentiator is calibrated confidence; every confidence display found in it was decorative.

## The rule (RATIFIED)
**Any confidence, reliability, verification count, or citation marker rendered to a user MUST be derived from a computed value or a resolved source. If nothing computes it, it does not render.** No hardcoded percentages, no static "verified" counts, no citation markers without a resolved source behind them, no confidence label set by a branch rather than an assessment.

## The instances (one pattern, found across the campaign)
1. **`reliability-first.ts:507`** — prompt directive "At the end, state: Reliability Score: X% | Sources: N verified | External Intel: Y". Model-emitted, regex-stripped intermittently. (Removed.)
2. **`reliability-first.ts:465-466`** — inline `[S#]` + SOURCES-section directive, fed an EMPTY source list → `[S1] … | Internal Database` mapping to nothing. (Removed.)
3. **`agent-chat:3987 / 3995`** — hardcoded `*Reliability: 100% | Sources: Fortress Database*` / `*Reliability: 100% verified from database*`. (Removed.)
4. **`agent-chat:326-333`** — a `**Sources:**` fallback footer with hardcoded `[S1] Fortress Signals Database` / `[S2] Fortress Incidents Database` / `[S3] External Intelligence Sources`. Chat has no resolved-source mechanism → decorative. (Whole block removed.)
5. **`agent-chat:956`** — silent prompt instruction "Cite sources with [S1], [S2] etc." → generated the marker scheme in chat. (Replaced with: reference the record's real signal/incident ID; do not invent markers.)
6. **quiet-period `Confidence: High`** (`generate-executive-report`, finding #2/#4) — a branch set confidence to 'High' over a main-tier-empty period. (Now 'Not assessed (no main-tier signals)'.)
7. **`97/100` posture score** (finding Q1, `common-operating-picture.ts`) — a GLOBAL threat-sweep score rendered as a per-client "Risk posture", direction-inverted. (Read removed.)

Also this turn: **`reliability-first.ts:452`** (the `[S${i+1}]` builder) DELETED as dead — "dead code that builds citation markers is a loaded gun for whoever wires it up next."

> **Caveat on the ":452 orphaned" premise:** the ruling said "the only caller passes an empty list." Incomplete — `agent-chat:688` also called `getReliabilityFirstPrompt(sourceArtifacts)` with **non-empty** artifacts (generic labels `Fortress Signals Database`, built at `agent-chat:679`). Deleting :452 means those generic labels no longer render as `[S#]` — consistent with the rule (they were generic decorative labels, not resolved per-source citations), but it leaves `agent-chat:673-688` (createSourceArtifact + the pass) as **dead code** (artifacts created, function now ignores them). Cleanup candidate — flagged, not deleted.

## Enforcement
`scripts/check-prompt-hygiene.mjs` **Detector 3 (BLOCKING)**: flags citation-marker literals (`[S\d]`), reliability figures (`Reliability: N%`), and confidence percentages (`N% confidence`) in non-comment emitted strings — excluding prohibition rules, the belt-and-braces stripper, and threshold descriptions ("entries below 50% confidence"). Currently **0 hits**. Wired into `security-gate.yml` (required PR check). Detectable subset only — a branch-set `confidence: 'High'` (#6) is NOT statically detectable, so that failure mode still relies on review + the quiet-period fix.

## Why this outranks the six fixes
The fixes close known instances; the rule prevents the next one. A product whose differentiator is calibrated confidence cannot ship decorative confidence — a single fabricated "100% verified" in front of a customer is worse than the metric's absence.
