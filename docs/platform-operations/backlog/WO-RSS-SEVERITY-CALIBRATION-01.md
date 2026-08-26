# WO-RSS-SEVERITY-CALIBRATION-01 — monitor-rss-sources is the severity inflation source

**Logged:** 2026-08-01. **Priority:** HIGH — the biggest real finding on the watchdog page (the "Severity distribution 85% high/crit vs ~18% target" finding). **Status:** read-only diagnosis done; **tuning HELD pending operator grading of the sample** (operator ground truth before any severity-logic change — same discipline as the incident grading).

## The number
High/critical signals by `signal_origin`, last 30 days: **`monitor-rss-sources` = 809 high/crit of 931 (87%)**; `unknown-legacy` = 548/753 (73%). Together ≈97% of all high/critical. RSS is the single dominant contributor.

## 1. How severity is assigned (the actual path)
`monitor-rss-sources` sets **no** severity itself — it ingests via `ingest-signal`, which computes severity **hybrid**:
- **Keyword rules** (`ingest-signal:67`, substring match on text): **p1 → critical** on `['credible threat','weapon','kidnap','active shooter','bomb']`; **p2 → high** on `['suspicious','prowler','tamper','breach attempt','intrusion']`. The p2 terms are broad and hit a lot of security/news copy.
- Else the **AI model** classifies (pyramid rubric at `ingest-signal:944–965`: "the large majority must be low/medium; grade CLIENT impact not headline drama"), with **analyst-feedback few-shot** injected (`862–899`). Default `medium` if unset.
- **Governance caps:** opinion-piece URLs forced to low (`489`); historical (>90d) forced to low (`1024`).
- **Not capped:** there is NO #83 producer ceiling on RSS (see §5). RSS emits high/critical freely.

## 2. Distribution per feed — UNIFORM, not a few feeds
Nearly every general-news feed is 70–96% high/crit: Energeticcity 96%, CityNews 94%, Global News Vancouver 93%, CBC National 92%, Vancouver Is Awesome 92%, 660 News 91%, Western Standard 91%, CBC BC 88%, APTN 83%, Calgary Herald 78%, Daily Hive 54%. **Systematic over-grading of general news, not feed-specific content** — the assignment layer, not the feeds.

## 3. Sample (20 random high/crit RSS, for operator grading — 2026-08-01)
Clear over-grades in the sample: "Home Price Forecast Increase" (high), "Plush red dragon toy sales surge" (high), "Cenovus Q2 Profit" (high), "Stolen Jewellery" (high), "Mobile veterinary clinic for animals affected by wildfires" (high), "CrossRoads Brewing location for sale after fire" (high), "Exploration of Nuclear Power" (high), "wildfire pact with Brazil" (high). These are news drama / general coverage, not client-impact threats — exactly what the rubric forbids. **Operator to grade before tuning.**

## 4. unknown-legacy — STILL being created (not purely historical)
1,475 total, 2026-04-02 → **2026-08-01 16:16 (today)**; **7 in last 48h, 65 in last 7d** (~9/day). Some signal path still emits signals with `signal_origin='unknown-legacy'` (an instrumentation gap — a creator not setting origin, coerced/defaulted to unknown-legacy). 73% high/crit. This is a SEPARATE producer contributing to inflation and needs its own origin-attribution fix.

## 5. #83 ceilings do NOT cover RSS
The #83 recalibration (2026-07-09) is **producer-specific**: `detect-threat-patterns`/`[PATTERN]` capped at MEDIUM (`patternSeverity`) + common-noun suppression; `monitor-domains` LOW-only. The watchdog #83 regression probe checks only those two. **`monitor-rss-sources` (and news generally) was never brought under any ceiling** — so the aggregate ≤18% target is measured, but the biggest producer has no cap. This is the structural gap.

## Candidate fixes (design; HELD until the sample is graded)
- Bring RSS/news under a producer-aware severity discipline (the #83 model, extended): news coverage defaults low/medium; high/critical requires a client-impact pathway (ties to WO-CLIENT-THREAT-RELEVANCE-01 — magnitude ≠ client-relevance).
- Narrow the p2 keyword rule (`suspicious`/`intrusion`/`breach attempt` are too broad for news text).
- Restart analyst feedback (the few-shot calibration is starved — feedback stopped 2026-07-15; the AI has no `wrong_severity` corrections to learn from).
- Fix the `unknown-legacy` origin gap so its producer is identifiable and cappable.
- **Do not tune the model prompt first** — grade the sample, define the target distribution empirically, then apply a deterministic ceiling + measure (measure-before-and-after).

---

## Operator grading result (2026-08-01) — the finding is PATHWAY, not producer
20 RSS signals graded (currently 1 critical / 19 high). Operator grades:
- **Unconditional low (10):** 2,3,6,12,13,15,16,18,20 (+ item 6). News drama / general coverage.
- **Unconditional high (1):** 17. **Medium (1):** 14.
- **Conditional on pathway (8):** 1,4,5,7,8,9,10,11,19 — "critical IF proximity+recent" (1,4,5,8,9); "critical IF associated to a Canadian energy company" (7); "medium IF associated to Canadian energy" (10); "high IF impacting supply chain or our people" (11,19).

**The operator could not grade 8 of 20 from the signal alone** — severity depends on *pathway* (proximity to client assets, recency, sector association, supply-chain/personnel impact), **none of which is in the title.** The assigner has the same blindness and defaults high on drama keywords ("wildfire", "evacuation").

### Scoping findings (read-only, 2026-08-01)
1. **Severity is assigned before pathway, on text only.** `ingest-signal` order: input `client_id` → relevance gate → `applyRules` keyword severity (`833`/`842`) → AI classification (`923`) → insert (`~1185`). **No `grounding_resolve_asset_links` / `client_geo_assets` / `score_signal_hazard` anywhere in ingest-signal.** `client_id` is ownership, never used for proximity. Pathway is resolved *later*, at incident-creation.
2. **The whole sample was MODEL-graded, not keyword-graded** — all 20 had `p12_keyword_hit=false` (no p1/p2 keyword in title or body). The AI is the inflation source for news; the keyword rules are not.
3. **0 of 5 wildfires resolve to a PECL asset**, and **4 of 5 have no gazetteer-resolvable place in the body** (pos 1 "northern Ontario", 4 no place, 5 "Anarchist Mtn", 9 "British Columbia" whole-province). Only pos 8 ("Clinton") resolved a place — and the RPC correctly returned *not near PECL*. So where a place is present the resolver works; where it is absent (the majority) the honest default is low.

---

## DESIGN RULING (2026-08-01) — grounding requirement, not a producer ceiling

**THE RULE: severity may not exceed `low` without a resolved pathway to the client.** This is WO-GROUNDING-01 applied to severity: a claim (*this is critical*) requires evidence (*a resolved pathway*) or it cannot be made. It is **not** a producer ceiling (which the operator rejected — it would suppress true criticals); a signal that *does* resolve a pathway keeps its high/critical grade.

### 1. Where the pathway check belongs — two options

**Option A — inside `ingest-signal`, after the model call, before insert.**
- Requires a **new text-taking RPC variant**: `grounding_resolve_pathway_from_text(p_client_id, p_text, p_location)` (the current RPC keys on `p_signal_ids` and reads `signals` by id — unusable pre-insert).
- Requires `client_id` known at severity time (it is — it's an input) and singular (see §3).
- **Advantage:** the inserted severity is already correct — no second write, and **no window** where a pre-downgrade high value can leak to realtime emit / `check-incident-escalation` / the alert pipeline.
- **Cost:** a new RPC that duplicates the resolver's place→gazetteer→`ST_DWithin` logic against raw text instead of a stored row.

**Option B — post-insert severity adjustment.**
- Signal now has an id, so the **existing corrected `grounding_resolve_asset_links(client_id, [id])` works as-is** — no new RPC.
- After insert: call the RPC with the just-inserted id; if `resolved=false` **and** computed severity > low, `UPDATE … SET severity='low'` (+ a `severity_grounding` marker) before returning.
- **Advantage:** reuses the RPC proven yesterday; smaller surface.
- **HAZARD (must be named):** the insert can fire realtime + downstream consumers *at the model severity* before the downgrade lands. The downgrade must complete **before any emit consumes severity**, or the pre-downgrade high leaks to alerts — the same emit-ordering class as INC-ALERTS-BRIDGE. Either run the downgrade synchronously in-band before the function returns and gate downstream on it, or accept a brief inconsistent window (not acceptable for a pageable tier).

**Recommendation to weigh:** Option A is structurally clean (no window); Option B is cheaper but reintroduces an emit-ordering hazard the platform has already been bitten by. Pick A unless the new-RPC cost is judged too high.

### 2. Place extraction — the gap is the gazetteer, not the field read
- **The resolver already reads the body.** `grounding_resolve_asset_links` does the extraction itself: substring-LIKE of gazetteer names against `normalized_text` (the body) **and** `location`. It does **not** read only the title. So "can it read the body" — yes, already does.
- **The real gap:** the gazetteer is **33 rows**, and the extraction is **substring-match of KNOWN places only** (no NER). A body that names "Anarchist Mountain" or "northern Ontario" won't resolve because those strings aren't in the gazetteer — the method cannot extract a place it doesn't already know. Two sub-gaps, both structural:
  - **(a) Coverage** — 33 rows is far too thin for national news. Needs expansion, or a geocoder fallback (e.g. Nominatim) for place strings absent from the gazetteer.
  - **(b) Extraction method** — substring-of-known-names can't surface a novel place. A candidate-place NER pass feeding a geocoder would, but that is a larger build.
- **Consequence to name:** every gazetteer miss floors a *real* critical to low (§4 tension). Gazetteer coverage is therefore not cosmetic — it directly governs false-negatives. This is its own sub-WO: **WO-GAZETTEER-COVERAGE-01**.

### 3. Multi-client signals — severity may have to become per-client (named now)
- **Current schema:** `signals.client_id` is a single scalar and `signals.severity` is a single scalar — one client, one severity per row. RSS signals today each carry a `client_id` (all 20 had `has_client=true`), i.e. the pipeline is already effectively fan-out (one row per (article, client)). **As long as that holds, per-signal pathway severity is correct with no schema change** — each row resolves against its own client's assets.
- **Where it breaks:** a genuinely shared / null-client / broadcast signal relevant to two clients with *different* proximity cannot carry two severities in one scalar. There is no representation for it today.
- **Named consequence:** if severity is to be pathway-grounded and pathway is per-client, then for shared signals **severity is inherently per-client and must move off the `signals.severity` scalar** — either (a) hard-commit to the fan-out model (one row per (article, client); confirm the RSS ingest actually fans out and doesn't ingest once-globally), or (b) a new `signal_client_relevance(signal_id, client_id, severity, pathway, grounding)` join table with `signals.severity` demoted to an aggregate/deprecated. **(b) is the bigger change and is named here now, not discovered later: WO-PER-CLIENT-SEVERITY-01.** For the current RSS path (single `client_id` per row) the rule ships without it; the shared-signal case is explicitly out of scope until that WO.

### 4. Clients with no geo assets — fail-open-flagged, do NOT floor
- BC Place has **0** geo assets (WO-CRT-GEO-ASSETS-01). If the rule floors everything to low until a pathway resolves, **every BC Place signal floors to low forever** — including a credible threat to the venue. Silently suppressing a venue client's criticals because nobody has drawn a polygon is the dangerous failure.
- **Also:** geo proximity is only **one** of the four pathways the operator named (proximity, recency, **sector association**, **supply-chain/personnel**). A no-geo client may still resolve on sector or named-personnel pathways. Flooring on geo-absence alone is wrong even in principle.
- **Ruling:** for a client with **no asset geometry**, geographic pathway is *unavailable*, not *unresolved*. The rule must **fail-open to the model grade** and mark the severity `severity_grounding='ungrounded_no_assets'` (honest: not asserted-grounded, not suppressed), **and emit a coverage-gap finding** ("client X severity is ungrounded — no asset geometry configured"). **Do not floor** (suppresses real threats) and **do not silently trust** (that's today's inflation). The floor-to-low rule applies only to clients that *have* pathway coverage and still failed to resolve. This makes the asset-config gap visible instead of converting it into silent suppression.

### 5. The model rubric already says this and is ignored — enforcement must be structural
The pyramid rubric at `ingest-signal:944–965` already instructs "the large majority must be low/medium; **grade CLIENT impact not headline drama**." The model grades headline drama anyway (all 20 sample over-grades were model-produced, §finding 2). **A prompt instruction is not an enforcement mechanism** — this is the identical finding to the WO-GROUNDING-01 entailment judge admitting non-sequiturs despite being told not to. **The severity ceiling must be a deterministic post-hoc gate** (pathway resolved → keep grade; unresolved-with-coverage → floor to low; no-coverage → fail-open-flagged), **not a reworded prompt.** Do not spend effort tuning the rubric wording; it cannot constrain severity.

### Build order when authorized (not now)
1. `severity_grounding` marker column (`grounded` / `ungrounded_no_assets` / `floored_no_pathway`) — makes every decision auditable (no-unauditable-gates).
2. Pathway check via Option A (text-taking RPC) or B (post-insert + emit-ordering guard) — decide first.
3. WO-GAZETTEER-COVERAGE-01 in parallel (the rule's false-negative rate is bounded by gazetteer coverage).
4. Measure-before-and-after: baseline the 85% high/crit, re-measure at 24h/72h/7d; success = distribution moves toward target **without** dropping a resolved-pathway critical.
5. WO-PER-CLIENT-SEVERITY-01 deferred until a shared-signal case is real.

---

## AMENDMENT 2 (2026-08-01) — pathway is a SET, not a geo test

**Accepted upstream:** the rule, Option A, the item-4 ruling (`ungrounded_no_assets`, fail-open-flagged, do not floor), item-5 (no rubric rewording). **GAP corrected:** AMENDMENT 1 treated pathway as *geographic only*. The operator's four grading conditions were proximity, recency, **sector association**, and **supply-chain/personnel impact** — **three of four are not geo.** `ungrounded_no_assets` would fire (and floor to model grade) on a signal that has a real non-geo pathway (e.g. pos 7 "Collaboration on Pipeline" — critical-if-associated-with-a-Canadian-energy-company, which no gazetteer resolves).

### 1. Pathway is a SET (minimum four) — resolvable-today status
| Pathway | Test | Data source | Resolvable TODAY? |
|---|---|---|---|
| **proximity** | place in body → gazetteer → `ST_DWithin` vs `client_geo_assets` | existing resolver + 33-row gazetteer | **YES**, coverage-limited (WO-GAZETTEER-NATIONAL-01 is the input) |
| **recency** | `event_date`/`temporal_grounding` vs now | `signals.temporal_grounding` (T-0), existing `>90d→low` rule | **YES** — but a **MODIFIER, not a standalone lifter** (operator's condition was "proximity **AND** recent"). Recency never lifts the floor alone; it multiplies/decays a pathway that already resolved. |
| **sector** | body names a competitor / supply-chain entity / same-sector operator | **already in the PECL client record**: `competitor_names` (9), `supply_chain_entities` (15), `industry='energy'` | **YES, no new data** (see §2) |
| **personnel** | body names a client entity or monitored person | `entities` where `client_id` + `active_monitoring_enabled` | **YES with existing data** — needs an entity-name match query wired; not yet built |

So: **all four are resolvable today**; proximity is coverage-limited, sector needs only a string-match against data already present, personnel needs a query wired, recency already exists as a rule and is a modifier not a lifter.

### 2. Sector — what it takes (no new data)
String-match signal text against `competitor_names ∪ supply_chain_entities`, plus a **sector-term vocabulary** for `industry='energy'`. Two caveats surfaced by the empirical run:
- **Vocabulary must cover the *whole* sector.** My test regex (`pipeline|lng|oil|gas|energy|petroleum|drilling|refin`) **missed pos 14 "Exploration of Nuclear Power"** (operator: medium) — nuclear/electricity/power weren't in it. The sector-term list is the exact twin of the gazetteer coverage gap: incomplete vocabulary = false-negatives.
- **Broad entity tokens over-match on substring.** `China` and `NOV` (both in `supply_chain_entities`) would substring-hit unrelated text (`NOV`⊂`Cenovus`/`November`). Needs word-boundary matching + curation, not raw `LIKE '%x%'`.
- **Decisive caveat: sector-match is a RELEVANCE gate, not a severity level** — see §3/§4 (pos 16 Cenovus).

### 3. How the four combine — two-stage, NOT a flat OR
A flat "any pathway → lift above low" **false-lifts routine business news** (proven in §4: pos 2 and pos 16). Proposal:

- **Stage 1 — RELEVANCE (any pathway):** proximity OR sector OR personnel resolves → the signal is *client-relevant*. No pathway resolves → floor to `low` (or `ungrounded_no_assets` fail-open per AMENDMENT 1 item-4 when the client has no coverage at all).
- **Stage 2 — SEVERITY within relevance:** the floor lifts above `low` **only if** relevance **AND** a **hazard/operational event predicate** fires — the client's own `monitoring_config.priority_keywords` are already the list (explosion, spill, leak, incident, violation, lawsuit, shooting, theft, trespass, vandalism, sabotage, blockade, protest, cyber…). Pathway *strength* + event *type* set the ceiling; **recency is the multiplier** (recent hazard on a resolved pathway → critical; stale → the existing `>90d→low` generalized).
- **Rationale:** a resolved pathway is *necessary but not sufficient*. "Brewery for sale after a fire" near the CGL corridor (pos 2, proximity=TRUE) and "Cenovus Q2 profit" (pos 16, competitor-match) are pathway-linked but **event-less** → they must stay low. Pathway presence answers *"is this about the client's world?"*; the event predicate answers *"is it a threat to them?"*

### 4. On-paper regression — the design's own test (empirical proximity + sector, 2026-08-01)
Proximity via the live resolver; sector via match against the real `competitor_names`/`supply_chain_entities` lists. `M1` = naive any-pathway-lifts; `M2` = two-stage (pathway AND hazard-event).

| pos | title | operator grade | prox | sector | M1 | M2 | M2 match? |
|---|---|---|---|---|---|---|---|
| 1 | Evacuations due to wildfires (N. Ontario) | crit-if-prox | F | – | low | low | ✓ (prox absent) |
| 2 | CrossRoads Brewing for sale after fire | **low** | **T** | – | **lift** | low (no hazard event) | ✓ |
| 3 | Wildfire aftermath (Clinton) | low | F | – | low | low | ✓ |
| 4 | End of weather reprieve, BC crews | crit-if-prox | F | – | low | low | ✓ |
| 5 | Evacuation Alert (Anarchist Mtn) | crit-if-prox | F | – | low | low | ✓ |
| 6 | wildfire pact with Brazil | low | F | – | low | low | ✓ |
| 7 | Collaboration on Pipeline | crit-if-energy | F | term | lift | lift (energy + operational) | ✓ |
| 8 | Evacuation orders (Clinton/Pear Lake) | crit-if-prox | F | – | low | low | ✓ |
| 9 | BC Wildfire Tally Past 100 | crit-if-prox | F | – | low | low | ✓ |
| 10 | Impact of pipeline project | med-if-energy | F | term | lift | lift (med) | ✓ |
| 11 | Wildfire Activity in Fraser Canyon | high-if-supplychain | F | – | low | low | ✓ (absent) |
| 12 | Home Price Forecast Increase | low | F | – | low | low | ✓ |
| 13 | Stolen Jewellery | low | F | – | low | low | ✓ |
| 14 | Exploration of Nuclear Power | **medium** | F | – | low | **low** | ✗ (sector-vocab gap: nuclear) |
| 15 | Plush red dragon toy sales surge | low | F | – | low | low | ✓ |
| 16 | Cenovus Q2 Profit | **low** | F | **Cenovus** | **lift** | low (no hazard event) | ✓ |
| 17 | Alberta Proposes New Pipeline | high | F | TransMtn+term | lift | lift (high) | ✓ |
| 18 | Mobile vet clinic (Thunder Bay) | low | F | – | low | low | ✓ |
| 19 | Fire Incident in Edmonton | high-if-supplychain | F | – | low | low | ✓ (absent) |
| 20 | Personal Carbon Rationing | low | F | – | low | low | ✓ |

**Scores:** M1 (naive any-pathway) = **17/20** — 2 false-lifts (pos 2 proximity-no-event, pos 16 competitor-no-event) + 1 false-neg (pos 14). M2 (two-stage pathway+event) = **19/20** — pos 2 and pos 16 correctly stay low; the **sole residual** is pos 14, a **sector-vocabulary coverage gap** (nuclear/power missing), fixable by completing the sector-term list → 20/20.

**What the regression proves before any code is written:**
1. The four-pathway model is directionally correct — **all 5 proximity-conditionals and both supply-chain-conditionals resolve to `low` in the absence of their pathway**, exactly as the operator intended.
2. **The mandatory refinement is the Stage-2 event predicate** — without it, naive pathway-match false-lifts 10% of the sample (routine business news near/about the sector). This is not optional.
3. **Sector vocabulary must cover the client's whole sector** (the pos-14 miss) — same discipline as gazetteer coverage.
4. **Not tested by this sample:** recency (no item turned on recency alone) and personnel (no item named a monitored PECL person). Those pathways need their own fixtures before build.

### Revised build order (supersedes AMENDMENT 1's list)
1. `severity_grounding` marker (`grounded`/`ungrounded_no_assets`/`floored_no_pathway`) + a `resolved_pathways[]` audit field (no-unauditable-gates).
2. Pathway resolver as a **set** (proximity via Option A text-RPC; sector via curated list match; personnel via entity match), returning which pathway(s) fired.
3. **Stage-2 event predicate** using existing `priority_keywords` — the regression shows this is what makes the rule correct, not the pathway set alone.
4. Complete the **sector-term vocabulary** (pos-14 lesson).
5. WO-GAZETTEER-NATIONAL-01 (proximity input) in parallel.
6. Recency + personnel fixtures before those pathways are trusted.
7. Measure-before-and-after; success = distribution toward target **without** dropping a resolved-pathway+event critical.
