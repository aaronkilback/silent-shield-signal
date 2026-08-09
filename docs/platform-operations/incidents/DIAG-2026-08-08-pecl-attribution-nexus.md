# DIAG-2026-08-08 — PECL (Petronas Canada) attribution nexus: how many signals reached the client feed without a PECL-specific anchor

**Read-only characterization (operator-directed, pre-correction). Nothing corrected or quarantined.** Question: *has PECL been shown signals that were not theirs, and if so how many and for how long.*

## Population
- Prod client **Petronas Canada** (`0f5c809d-60ec-4252-b94b-1f4b6c8ac95d`, active, 42 monitoring keywords). (`_benchmark_petronas` fixture excluded.)
- **1,791 signals** attributed to PECL, **2026-03-29 → 2026-08-08** (~4.3 months): **1,700 active / 91 quarantined** (the 91 all `quarantine_reason=NULL` — not the auto-fabrication reason).
- **1,244** carry `raw_json.matched_keywords` (the keyword-attributed subset this analysis assesses). The other **547** have no recorded matched keywords (older/other ingestion paths) — **not assessable from keyword data**.

## Method
`matched_keywords` unnested per signal, prefixes stripped (`asset:`/`keyword:`/`competitor:`/`tier2:`/`client_name:`). A signal has a **PECL-specific anchor** if any matched term contains a PECL-distinctive token: `petronas|pecl|coastal gaslink|lng canada|montney|progress energy|kitimat|stand.earth|fort st(. john)|tumbler ridge|hudson('s hope)|(wet')suwet('en)|(molly )wickham|gidimt|unist|dawson creek|chetwynd|groundbirch|bc energy regulator|explicit_client_override|ai_contextual_match|entity:`. Absence of all = **no anchor** (matched only on generic industry terms or broad-geography queries).

## Result — 665 client-facing signals with NO PECL-specific anchor (53% of keyword-attributed)
| | count |
|---|---|
| Keyword-attributed PECL signals | 1,244 |
| **With** a PECL-specific anchor | 579 |
| **NO anchor** | **665** |
| — of which **active / client-facing** | **665 (100%)** |
| — of which quarantined | **0** |

**Breakdown of the 665 (what they actually matched on):**
| Category | count | what it means |
|---|---|---|
| Broad-geo wildfire | **382** | `wildfire+canada` / `+british columbia` / `+bc` / `+first nation` / `+alberta` / `+nwt` — attributed on region+wildfire, **no proximity to PECL assets** |
| Generic energy | **215** | `energy`, `pipeline`, bare `lng`, `natural gas`, `oil and gas`, `oilsand(s)`, `first nation` — generic industry terms |
| Competitor-only | **26** | `suncor` / `cenovus` / `imperial oil` — signals about **other companies** |
| Other | **42** | — |

## Trend — a step-change in July (was NOT always this bad)
| Month | signals | no-anchor | no-anchor % |
|---|---|---|---|
| 2026-03 | 24 | 12 | 50% (small n) |
| 2026-04 | 261 | 28 | **11%** |
| 2026-05 | 283 | 69 | **24%** |
| 2026-06 | 36 | 3 | **8%** |
| 2026-07 | 475 | 394 | **83%** |
| 2026-08 | 165 | 159 | **96%** |

Moderate (8-24%) through June, then **jumped to 83% (July) / 96% (August)** — a step-change, driven mainly by the 382 broad-geo wildfire attributions (a July wildfire-monitoring volume/logic change began mass-attributing broad Canadian/BC wildfire signals to PECL).

## Answering the specific sub-questions
- **Token-boundary failures (matched inside a larger word):** essentially **not PECL's failure mode.** Unlike the Kilbacks case (`home`→"homeless"), PECL's matched terms are compound query-descriptors (`wildfire+canada`) and whole generic words — not substrings embedded in larger words. PECL's problem is **genericness + broad geography**, not substring fabrication.
- **Too-generic-to-constitute-nexus:** the 665 above (382 broad-geo wildfire + 215 generic energy + 26 competitor + 42 other).
- **Client-facing vs quarantined:** **665 active / 0 quarantined.** Every one reached the operator surface.

## Caveats (so the number is defensible, not overstated)
1. **Upper bound on "not theirs."** Some broad-geo wildfire signals may in fact be near PECL's NE-BC assets (legitimately relevant) — but the matching had **no geographic precision** to establish that; they were attributed on "wildfire + broad region," not proximity. They reached PECL without an established nexus even where some are coincidentally relevant.
2. **Competitor monitoring is a legitimate feature**; the 26 competitor-only signals are about other companies, not threats to PECL — count them per how CRT frames competitor coverage.
3. **547 non-keyword-attributed PECL signals** are outside this assessment.

## ROOT CAUSE (traced 2026-08-09) — the TIER-2 fuzzy match, not a July commit
The 382 broad-geo wildfire attributions come from the **TIER-2 fuzzy match** in
`process-intelligence-document` `matchClientKeywords` (`process-intelligence-document/index.ts`
~L425-431). When a document has **no direct keyword hit** (`score === 0`), the rule fires if it
contains ANY `INDUSTRY_TIER_KEYWORDS[industry]` term (energy incl. `pipeline`, `lng`, `wildfire`, …)
**AND** any `REGIONAL_ANCHORS` term — and `REGIONAL_ANCHORS` **mixes broad regions with specific
places**: `'canada','british columbia','bc ','alberta','saskatchewan','northwest territories','yukon'`
alongside `'kitimat','fort st. john','montney','prince rupert','peace river','duvernay',"wet'suwet'en"`.
So *"B.C. declares state of emergency due to wildfires"* → `tier2:wildfire+british columbia` → PECL.

- **Provenance:** added **2026-05-12** — commits **f8cbe3a5** ("add tier-2 industry/region fuzzy match")
  + **d28dd1a7** ("broaden tier-2 list"). **NO July commit.** The July step-change (8% → 83% → 96%) is
  **fire-season volume** hitting the pre-existing broad rule — May/June low-fire → moderate; July/Aug
  fire season → BC wildfire-news flood → all `wildfire+british columbia` → PECL. Discrete-looking
  because fire season is discrete; it is a latent-rule-meets-volume, not a code regression to revert.
- **Proximity was never computed — that is the defect, not merely the false positives.** The rule
  accepted *province-level* (`british columbia`, `canada`) as a proxy for proximity to PECL assets. The
  382 are, by construction, anchored on a broad region, so **none established asset-proximity**. The
  proximity-relevant wildfire signals (anchored on `fort st. john`/`montney`/`kitimat`) fall in the
  **579 with-anchor** bucket, not the 665 — i.e. PECL DOES get real-proximity wildfire coverage today.
- **PECL geography exists** (18 locations + 7 assets) and `REGIONAL_ANCHORS` already contains PECL
  specifics → the fix is a **filter, not a rebuild, independent of Phase 3**: drop the BROAD anchors
  (`canada / british columbia / bc / alberta / saskatchewan / nwt / yukon / first nation(s)`), keep the
  specific ones. Result: the 382 broad matches stop; `wildfire+fort st. john`/`+montney`/`+kitimat`
  continue. Alternatively disable the tier-2 fallback entirely (PECL then loses proximity wildfire too).

## Rulings (operator, 2026-08-09)
1. **STOP THE BLEEDING** — tighten/disable the broad-geo wildfire (tier-2) attribution independently of
   Phase 3. Report-first done (this section); fix is a REGIONAL_ANCHORS edit, ready on operator go.
   "Rather PECL see zero wildfire signals than 382 they cannot act on."
2. **DO NOT correct the 665** — same hold as the 611: correcting the old matcher's errors with the old
   matcher's judgement is circular. **Add the 665 to the Phase 3 cutover criteria alongside the 611**:
   for each, does the NEW matcher accept or reject. Correct ONCE, from the semantic verdict.
3. **DISCLOSURE** — raise with PECL + CRT **after cutover, not before** (the conversation is materially
   different with the fix live vs validating). Target: within a week of Phase 3 cutover. Prepare nothing
   yet; when there, want the floor/ceiling framing + the July regression traced to commit + shadow
   evidence. Recorded as operator position.

## Disposition
Numbers only, per operator — **no corrections/quarantine yet.** Phase 3's stricter matcher
(token-boundary + geo-anchor + semantic) is the built remediation; the shadow's 26h live sample already
rejects 24 of 24 PECL live matches. The tier-2 broad-anchor tightening is the immediate stop-the-bleeding
lever, awaiting operator go.
