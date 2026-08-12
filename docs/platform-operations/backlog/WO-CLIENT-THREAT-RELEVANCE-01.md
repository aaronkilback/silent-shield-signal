# WO-CLIENT-THREAT-RELEVANCE-01 — priority must derive from threat-to-THIS-client, not threat magnitude

**Logged:** 2026-08-01. **Priority:** the item after the WO-INCIDENT-QA gate measurement (that measurement is done — see below). **Class:** relevance/grading correctness — upstream of the emit-seam and recipient-provisioning holds.

## THE INVERSION — defining evidence (gate replay, BC Place, 2026-08-01)

> **"Russian State-Sponsored Targeting of poorly configured networks"** — global cyber news, no connection to a Vancouver stadium: **relevance 0.70 → admitted as P1.**
>
> **Pitch invasion at BC Place during the Canada vs. Curaçao match** (protesters reached the field, attached themselves to the goalposts): **relevance 0.50 → refused.**

The topical scorer ranks a threat with **zero** pathway to the client **above** an event happening **inside the client's own venue.** Everything else in this WO follows from that one pair. The relevance metric is not weak — it is **backwards**.

## The gate makes a backwards metric WORSE, not better (2026-08-01)
The WO-INCIDENT-QA gate tightens on `relevance_score` (raises the bar, adds a confidence floor). Applied to a **wrongly-ordered** metric, tightening **removes true positives faster than false ones**: the pitch invasion (rel 0.50, a true positive) is cut, while Russian FSB (rel 0.70, a false positive) survives. **Tightening a backwards metric is not a partial fix — it is a regression**: it improves the aggregate refusal rate while preferentially discarding exactly the client-specific material the product exists to surface. The gate must not be tuned tighter until the metric it gates on is re-ordered to client-pathway. Order first, threshold second.

## UPSTREAM OF RELEVANCE — the platform has no concept of EVENTHOOD (operator grading, 2026-08-01)

The inversion pair shows relevance is wrongly *ordered*. Operator grading of the residual queue shows something **larger and upstream**: **the platform has no concept of EVENTHOOD.** Presented with the 15 substantive open incidents — the residue **after** clearing benchmark, pattern, and weather noise, i.e. the best the queue had to offer — **the operator graded 0 of 15 as incidents.** Every one, *including the well-formed, genuinely client-relevant ones*, is a **signal**, not an incident:

- open letters, campaigner statements, opinion pieces ("Social Sentiment…"), and **routine regulatory filings** (FortisBC waste-discharge amendment; an emissions report filed to the BCER) were all promoted to **P1**.
- These are real, on-topic, client-relevant — and still not incidents. Nothing *occurred* that warrants tracked client response; they are the ambient activity of the client's world.

**An incident requires three things, ALL of them:** (1) **something occurred** (an event, not a statement/filing/opinion), AND (2) a **pathway to this client** (asset/entity/operations), AND (3) **a decision is warranted** (tracked response). **Relevance is necessary and NOT sufficient.** The current pipeline has only a relevance gate; it has no eventhood test and no decision-warranted test — so it converts *client-relevant reading material* into P1 incidents.

**Consequence for sequencing:** fixing the relevance *ordering* alone (the inversion) yields **correctly-ranked non-incidents** — the pitch invasion would out-rank the regulatory filing, but both would still be "incidents," and neither the filing nor most of the queue should be one at all. **Eventhood + decision-warranted are prerequisites, not follow-ons.** Ordering relevance is necessary; it is not the whole fix.

- **Grading record (2026-08-01):** 15 substantive items, **0 graded as incidents.** Dispositions (operator): most = "not an incident"; several relevant ones = "awareness tier, not an incident"; one = "not client-relevant." **2 held for checks:** the Canada/Curaçao pitch invasion (LIVE, in-window — an actual occurrence at BC Place; the one item with genuine eventhood) and "Fracking the Peace" (worksite/personnel check: names no PECL worksite/facility/individual → fails). The 13 graded non-incidents were closed as `news_reclassified` (signal, not incident).

## Finding
An incident's priority currently derives from **threat magnitude** (how severe the event is in general), not from **threat-to-this-client** (does it reach this client's assets, entities, or operations). The admission gate's `relevance_score >= 0.60` is a **topical keyword match**, so global cyber/crime news clears it for any client that monitors security terms — while a genuine, client-specific event can score *below* it.

## Killer evidence — the relevance metric is INVERTED (gate replay, BC Place, 2026-08-01)
Replaying the WO-INCIDENT-QA gate against BC Place's delivery-tier incidents:

| Material | category | relevance | gate verdict | reality |
|---|---|---|---|---|
| "Russian State-Sponsored Targeting of poorly configured networks" | active_threat | **0.70** | **ADMIT → P1** (if corroborated) | global cyber news, nothing to do with a Vancouver stadium |
| "Protesters interrupted the Canada vs. Curaçao match **at BC Place, reaching the field**" | protest | **0.50** | **REFUSE (relevance_below)** | an actual pitch invasion at the client's own venue |

**The topical scorer gave global Russian-FSB news HIGHER relevance (0.70) than a pitch invasion at BC Place's own stadium (0.50).** The gate would page on the former and drop the latter. This single pair is the whole defect.

## The gate is a partial fix, not the fix (measurement result, WO-INCIDENT-QA)
- Of BC Place's 8 `news_reclassified` P1s, the gate would now REFUSE **7** (relevance 0.3, or confidence < 0.65) — good. But **1 survives**: Russian FSB (rel 0.70, active_threat) still admits as **P1**. Magnitude-relevance, not client-relevance, lets it through.
- `severityToPriority` was tightened so **P1 requires `category='active_threat'`** — this correctly caps cyber/crime news at P2. But P2 is still delivery-tier (notification), so admitting topical-but-irrelevant material still pages.
- The gate's recorded refusals since 07-24 are all defensible (global CVEs for BC Place; pathway-less Cariboo wildfires for PECL) — so it is **not over-tight in practice yet**; the failure is the inverted relevance metric, which is both leaky (Russian FSB) and, on replay, wrongly tight (pitch invasion).

## Scope (design; not built here)
An incident's admission AND priority must be a function of a **pathway to THIS client**:
- **Asset pathway** — PostGIS proximity/corridor/HQ overlap (`client_geo_assets`; the hazard branch already does this — generalize it beyond hazards).
- **Entity pathway** — the signal names/relates to an entity in the client's graph (client org, monitored persons, adversary set).
- **Operations pathway** — the event touches the client's line of business / operating area / event calendar (a stadium's match schedule; an energy client's pipeline corridor).
- Topical keyword relevance may REMAIN as a coarse pre-filter, but it may NOT be the thing that sets priority. No pathway → awareness only, never a page.

## The three existing signals of this defect (as referenced)
1. **BC Place P1 stream** — 10/13 delivery-tier incidents were global cyber/crime news mis-graded critical for a stadium; the inverted-relevance pair above.
2. **PECL 43-of-47 high-severity** — the severity-regression finding (`project_severity_regression_2026_07_29`): magnitude-driven grading floods high/critical without client-pathway discrimination.
3. **Empty `client_geo_assets` for CRT** (WO-CRT-GEO-ASSETS-01) — the asset-pathway that would grond client-relevance does not exist for BC Place, so even the one pathway signal we have is unavailable for the client whose threat model is most geographic.

## Sequence
Gate measurement — DONE (this WO's trigger). This item is next. **Downstream of it, still held:** emit-seam single-point-of-creation, recipient provisioning. Do not wire pages until priority reflects client-pathway, or the plumbing will faithfully deliver magnitude-graded noise.

## Related finding — incident-layer dedup gap (record, 2026-08-01)
The 14 PECL "Weather — B.C. South/North Peace River" incidents just bulk-closed as `noise` were **one weather event rendered as 14 separate incidents** (11 opened on 2026-07-18 alone). This is an **incident-layer instance of the same dedup gap as WO-PROVENANCE-01 step 4 (report-layer dedup — designed, never built).** The defect is the same shape at a different layer: no collapse of many signals/renderings of a single real-world event into one tracked object.

- **Invariant:** one real-world event → one incident. A weather advisory, a wildfire, a match — repeated coverage or repeated advisories for the same event must correlate to the existing incident, not mint a new one.
- **Relationship to this WO:** dedup and client-relevance are the two halves of incident quality — relevance decides *whether* an event becomes an incident; dedup decides that *one* event becomes *one* incident. Both must land before emit is wired, or the pipeline pages N times for one event, at a priority set by magnitude not pathway.
- **Cross-ref:** WO-PROVENANCE-01 step 4 (report-layer dedup); this is its incident-layer sibling. Build them against a shared event-identity key.

## REFERENCE CASE (pinned, 2026-08-01)
**Incident `704b2b43-97fd-4ec1-8cd4-ceced7ced0f3` — "Protest Activity — Canada, Curaçao" (BC Place, 2026-05-26)** is the **single confirmed eventhood item across the entire graded set**: something *occurred* (protesters reached the field and attached to the goalposts), *at the client's own venue*, *in-window* (ingested same day). It was **correctly detected, never escalated, never delivered, and sat open 66+ days.** It is the standing evidence for this WO — detection worked; every downstream layer (eventhood grading, priority-by-pathway, emit, delivery) did not.

**Pinned via `incidents.aging_exempt=true`** so `incident-lifecycle-sweep` will NOT auto-`expired` it on ~2026-08-12. Exemption mechanism: the `aging_exempt` boolean (migration `incident_aging_exempt_flag`) + a `.eq('aging_exempt', false)` guard in the sweep query — a pinned incident is skipped by both the stale and expire paths. `aging_exempt_reason` carries the citation. Un-pin only when this WO closes.

## Pattern-layer follow-ons (SCOPE, do not build — 2026-08-12)

Surfaced by the false "Summerland entity-escalation" pattern (Petronas, 13km from Kilbacks household):

1. **Pattern-detector PROXIMITY (operator: scope not build).** `detect-threat-patterns` groups by entity/geography and computes NO distance to `client_geo_assets` (`has_proximity=false` on every pattern; 0 refs to client_geo_assets). Give it the same asset-proximity the D6 gate now has (`evaluateClientPathway` / `score_signal_hazard_pathway`) so "Summerland escalation" becomes "Summerland escalation, 13km from Kilbacks household." It computes something real and strips the only part that makes it actionable.

2. **Pattern-layer + briefing QUALITY FILTERING (the "more" this case needs — Option C is otherwise inert).** `detect-threat-patterns` AND `send-daily-briefing` read `signals` by `client_id` with **0 references to `attribution_type`, `signal_client_attributions`, or the quarantine filter**. So the Option C superseding records (271 `attribution_type='none'`, applied 2026-08-12) are inert downstream — the detector will regenerate the false Petronas pattern until it honors the correction. Minimal fix: both layers skip signals with an authoritative `attribution_type='none'` record AND apply `applyAnalystSignalFilter` (a pattern/briefing layer reading raw unfiltered signals is a Quarantine-Doctrine gap regardless). Provenance: `feedback_fabricated_attributions_become_inputs`. **Immediate stopgap applied:** the existing false pattern signal `68a2e33e` set `status='false_positive'` (the one lever the briefing honors); regenerates until #2 ships.

### Item 1 BUILT + deployed 2026-08-12
`detect-threat-patterns` + `send-daily-briefing` now apply `applyAnalystSignalFilter` (quarantine)
AND exclude signals with an authoritative `attribution_type='none'` record. Option C corrections
are now honored in both layers; the false Petronas Summerland pattern will not regenerate.
**Other derived layers NOT chased (operator: log, don't chase):** any layer that reads raw
`signals` by `client_id` without these filters has the same gap — candidates to AUDIT later (not
now): predictive-incident-scorer, generate-executive-report, belief/score stores. Deferred.
