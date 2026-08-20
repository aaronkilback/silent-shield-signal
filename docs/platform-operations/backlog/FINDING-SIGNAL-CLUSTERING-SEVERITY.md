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

## Evidence report (2026-08-20, report-only — no design)
Context: ~2 signals/24h; absolute volume tiny. This is scale-setting + one live-defect check.

**(3) THE ONE THAT MATTERS — does a client see the same event twice in a brief? YES (defect confirmed).**
`generate-executive-report` HAS a dedup (lines 440–462): key = CAP identifier → else event+area → else
**exact normalized-title + day**. That collapses case/punctuation variants and CAP updates, but a cross-outlet
pair with *different titles* gets *different keys* and both survive. Empirical: the **last PECL brief**
(`cf6299db`, window 2026-08-13→08-20) window contains exactly **one** such surviving pair — the Kitimat event:
"Funding for Eco Depot in Kitimat" (Medium) + "Eco Depot Funding" (High), sim 0.563, same day, non-CAP. The
dedup did not fire on it. **This is a rendering defect in the client artifact, independent of clustering, and
fixable on its own** (the dedup's title key is exact where it needs to be fuzzy for the cross-outlet case).

**(1) Scale — how many multi-row events (heuristic).** Heuristic: two active signals, same client, same
calendar day, pg_trgm title `similarity >= 0.5`. Raw pairs = 23,548 — but **22,275 are "phishing" with
identical title AND same source** (exact repeat alerts, a different problem; the exact-title dedup already
collapses these). The genuine **cross-outlet class** (different title AND different source) is **~540 pairs
over 4.7 months / 13 clients** — concentrated in civil_emergency (145), weather (217, CAP-templated),
operational (77), regulatory (51). Order of magnitude: **hundreds of pairs total**, single-digit per day. Rough.

**(2) Severity disagreement — rare and small ⇒ dedup problem, not a severity-reliability problem.** Across all
near-dup pairs only **2.0% disagree on severity**, avg severity_score gap **0.3** (max 69). Disagreement
concentrates in a few event categories (civil_emergency 24%, protest 17%) but is negligible overall. Per the
operator's own test ("rare ⇒ dedup problem; common ⇒ severity unreliable"): **rare ⇒ dedup problem.**

**(4) Where signal severity comes from.** NOT an LLM free-score per row. Hierarchy in `ingest-signal`:
rules-based keywords (P1/P2, lines 1021–1023) **>** monitor-passed `fallback_severity` (e.g. monitor-geo-wildfire
computes it deterministically from evac/fire status) **>** LLM classification (used when no rule/hint). Then a
deterministic map to `severity_score` (critical 90 / high 70 / medium 40 / low 20, ± relevance). Fixed once at
creation; no post-insert reconciliation. So the Kitimat Medium-vs-High came from the LLM classifying each
outlet's article independently (news path, no rule, no monitor hint).

**(5) Does the exposure clusterer fit? NO — it would need its own.** The exposure clusterer
(`_shared/subject-retrieval.ts`) is coupled to subject/legal identity: keys on case-name/citation/subject-anchor,
ranks on `is_finding`/`obscurity_rank`/`location_count`, persists to `subject_exposure_items` by
`(subject_entity_id, fingerprint)`. Signals are client-scoped event rows with pre-computed severity and no
query provenance — different shape. Verdict: not reusable. Note: a signal-side clusterer **already exists in
code** — `consolidate-signals` (union-find on location+event / source+actor / title / keyword-overlap) +
`detect-near-duplicate-signals`; whether it currently runs was not verified here.

## Pointer
- Solved-on-the-other-side reference: `supabase/functions/_shared/subject-retrieval.ts` (clusterer +
  `compareExposureItems` consequence ranking); exposure-item severity-from-content work (WO-ENTITY-DEDUP era).
- Signal pipeline entry: `ingest-signal` (per-source row creation), consumed by the signals feed + AEGIS.
