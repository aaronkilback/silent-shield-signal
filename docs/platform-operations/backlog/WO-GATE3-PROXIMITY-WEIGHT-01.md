# WO-GATE3-PROXIMITY-WEIGHT-01 — is client-asset proximity actually weighted in relevance?

**Status:** LOGGED — do NOT build yet. **Opened:** 2026-07-31.
**Provenance:** WO-GROUNDING-01 Phase 2 gazetteer work + finding #3.

## Finding
Asset-proximate PECL signals (resolve a Gate-3 asset link via `grounding_resolve_asset_links`) average **0.6**
relevance vs **0.5** for non-linked signals — a **0.1 separation** (30-day sample: n=52 proximate, n=527 not).
If proximity to client-operated assets barely moves the relevance score, **client-aware relevance is weakly
implemented** — the "coverage" dimension of the four-lane test is not actually being served by geography.

This compounds two now-fixed data gaps (WO-GROUNDING-01): the gazetteer was 22 rows and missing Taylor (a place
with PECL infrastructure), so historically even fewer proximate signals would have resolved at all — meaning the
measured 0.1 is an UPPER bound on the historical proximity signal (it was likely weaker before the 37-row fix).

## Scope (assessment, not a build)
1. **Historical replay** of 30–90 days of PECL signals through the CORRECTED 37-row gazetteer + Gate-3 resolver:
   for each signal, `scored_now_proximate` (resolves an asset link today) vs the relevance it `scored_then`.
2. **Quantify under-crediting:** how many asset-proximate signals received a below-tier relevance score; of those,
   how many would have reached **main tier** had proximity been properly weighted.
3. **Decide the fix (separate WO):** whether Gate-3 proximity should be a stronger relevance term, and by how much,
   validated against operator-labelled ground truth (do NOT tune on the score alone — confidence ≠ correctness).

## Why it matters
This is the **coverage lane** of the four-lane relevance test: a client-relevant signal that is geographically in
the client's operating footprint but scored as generic noise is a coverage miss. Gate-3 is the mechanism that is
supposed to catch exactly those; the 0.1 separation suggests it currently does not.

## ⚠ Dependency — DO NOT replay until WO-GAZETTEER-BACKFILL-01 completes
The replay's numbers depend on verified coordinates. WO-GAZETTEER-BACKFILL-01 verified/attributed 32/33 gazetteer
rows (BC deltas ≤2.2km, dedup done, Peace River removed); **`calgary` remains un-attributed pending an authoritative
Alberta source.** Replaying against unverified coordinates produces unreliable numbers — complete the backfill
(incl. calgary) first, then replay.

## Dependencies
- WO-GROUNDING-01 gazetteer authoritativeness (37 rows, BCGN-sourced) — the corrected resolver this replay uses.
- The relevance-scoring pipeline's current use (if any) of the Gate-3 asset-proximity signal — to be located first.
