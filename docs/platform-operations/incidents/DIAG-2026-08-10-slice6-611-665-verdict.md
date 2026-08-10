# DIAG-2026-08-10 — Slice 6: deterministic verdict over the 611 + 665 held sets (REPORT, pre-correction)

The current matcher (token-boundary on client keywords/name/entities + geo proximity via gazetteer `ST_DWithin` to `client_geo_assets`) run over the stored text of both held sets. **Deterministic verdict — the correction basis. Nothing corrected yet.** Semantic leg (held out of the live gate) to be run in parallel + reported separately for agreement only.

## 611 — `fabricated_client_match_phase1` (Kilbacks, still quarantined)
| | count |
|---|---|
| Total | 611 |
| **REJECT** (matcher also rejects → quarantine was RIGHT) | **610** |
| **ACCEPT** (matcher would keep → quarantined something real) | **1** |

- The **1 accept** is *"New Affordable Rental Homes"* — geo-matched on `Penticton`, but it is a housing article with **no Kilbacks nexus**: a false-positive of the geo test (mentions a nearby place, is not a threat). So **0 genuine recoveries** in the phase-1 set.
- **The 611-accepts (the ones you cared most about) are not here — because they already happened.** The real Bald-Range-type recoveries (the **7 wildfire/evacuation signals** released 2026-08-10) were in the **broader** quarantined set (auto/NULL reason), not the phase-1 short-keyword subset. The phase-1 611 (`home`/`cabin` substring) was **genuine noise**, and the deterministic matcher confirms it: no real threat is hiding in the 611.

## 665 — PECL no-anchor (active, client-facing)
(Set is 686 as of this run — grew slightly since the 665 snapshot as signals accrued.)
| | count |
|---|---|
| Total (no-anchor) | 686 |
| **REJECT** (not theirs — confirmed) | **635 (93%)** |
| **ACCEPT** (defensible after all) | **51 (7%)** |
| — accept via PECL keyword/name (real relevance, mis-flagged no-anchor) | 3 |
| — accept via **geo/proximity** to a PECL asset | 20 |
| — accept via **competitor** name only | 28 |

- **635 reject** is the strong confirmation of the PECL nexus finding: PECL saw ~635 signals with no PECL term, no proximity, not even a competitor mention — **not theirs.**
- **3 keyword accepts** = genuine PECL relevance the anchor regex missed (all `LNG Canada`: *"LNG Canada Prepares for Phase 2"*, *"LNG Canada Signs Pipeline Agreement"* …). Defensible; a regex gap, not a matcher gap.
- **20 geo/proximity accepts** = mention a PECL-region place within an asset radius. **Mixed**: genuinely relevant (*"Wildfire reported near Tremblay"* → Chetwynd/Dawson Creek, near PECL's Montney ops; *"Prescribed burn Fort Nelson"*; *"Windy Creek Wildfire"* → Chetwynd) vs marginal (*"Calgary air quality warning"* via the 80 km Calgary-HQ radius). This is the geo-anchoring thesis **recovering real relevance** from the "no-anchor" pile — the same shape as the Bald Range recovery, from the other client.
- **28 competitor accepts** = Shell/Suncor/Imperial Oil etc. — *about a competitor*, not "PECL's own." A **labeling** fix ([[WO-HONEST-ATTRIBUTION]]), not a keep-as-PECL.

## Answering the four questions (deterministic)
1. **611 the matcher also rejects (quarantine right):** **610 / 611.**
2. **611 it accepts (quarantined something real):** **1 — and it is NOT real** (housing article). The genuine recoveries were the 7 already released from the broader set. The phase-1 quarantine holds.
3. **665 it rejects (PECL saw non-theirs):** **635 / 686 (93%).**
4. **665 it accepts (defensible after all):** **51** — but only **~23 genuinely** (3 keyword + 20 proximity); **28 are competitor** (relabel, not keep-as-own).

## CORRECTIONS ORDER (operator 2026-08-10) — findings

### Item 1 — anchor completeness: the reject number barely moves on GENUINE anchors
- **Keyword fix:** the abbreviated anchor regex already contains `lng canada`; the 3 keyword accepts were recovered by **text token-match** (they had "LNG Canada" in body but not in `matched_keywords`). Genuine-keyword completeness moves reject **635 → ~632** (the 3 LNG Canada signals). **Minimal.**
- **Adding PECL entities APPEARED to move it 635 → 485 (161 recovered) — but that is a POLLUTED-ENTITY-LIST ARTIFACT, not real nexus.** The entities driving it: `Wildfire Service`(35), `Carney`(21), `firefighters`(20), `Danielle Smith`(16), `Trump`(16), `David Eby`(14), `Donald Trump`(10), `Mark Carney`(10), `Canadians`(4), `customers`(3), `Albertans`(3), `B.C. premier`, `U.S. senator`… — **political figures + generic nouns, not PECL's people.** Matching them attributes broad political/wildfire news to PECL — the same over-attribution vector as tier-2 broad match, at the entity layer.
- **Verdict:** the reject stays **~632** on genuine anchors — the 635 does NOT materially move. **NEW FINDING → separate WO: PECL's `entities` list is polluted** (political figures, generic groups, non-persons like "Wildfire Service"/"firefighters"/"customers"). It must be cleaned before entities can be trusted as an anchor. A few are real (`Peter Zebedee` = LNG Canada CEO); most are noise.

### Item 2 — PECL asset radii + proposed defaults by type (the 80km HQ is wrong)
| Asset | Type | Current radius | **Proposed default** |
|---|---|---|---|
| Montney / Fort St. John upstream | operations_point | **120 km** | **50 km** (field area, not a whole region) |
| Horn River / Fort Nelson upstream | operations_point | **100 km** | **50 km** |
| **Calgary HQ** | hq_office | **80 km** | **25 km** — an office is a building; an 80 km wildfire radius attributed Calgary-region smoke/air-quality to PECL |
| LNG Canada terminal (Kitimat) | lng_terminal | 60 km | **30 km** (fixed facility) |
| Coastal GasLink corridor | pipeline_corridor | 30 km | **15 km buffer around the LINE** (linear asset, ST_DWithin on geometry, not a point radius) |
| (household residence/school) | residence/school | 30 km | 30 km (life-safety — keep) |

**Principle: radius reflects what threatens THAT asset.** A gas plant/terminal = fixed 30 km; a field operation = its area + ~50 km; a corridor = a line buffer; a **corporate office = 25 km, not 80** (the 80 km HQ radius is the source of the Calgary-air-quality geo false positives). Retuning these tightens the 20 geo accepts to the ~operational-proximity ones (Montney/Horn River/Fort Nelson/Chetwynd) and drops the Calgary-HQ marginals.

### Item 3 — competitor relabel: HELD until `attribution_type` ships ([[WO-HONEST-ATTRIBUTION]]), then relabel in one pass. No action now.

### Item 4 — the 635 (≈632): HOLD. Options for preserving honest history
| Option | What it does | Honest-history impact |
|---|---|---|
| **A. Quarantine (retroactive)** | set `quality_status='quarantined'` | **REWRITES the record** — hides what PECL was shown; pretends they weren't. Worst. |
| **B. Flag-but-leave** | keep active, tag `raw_json.nexus_review` | preserves what they saw; **mutates the signal row** (edits the artifact). |
| **C. Annotate with a superseding attribution record** | append-only NEW record (attribution_type='none'/superseded) referencing the signal; original untouched | **Best** — the signal stays exactly as PECL saw it (honest history), the correction is a separate, dated, durable record; matches the Provenance Doctrine (append-only, no destructive rewrite); lets **correction + disclosure be decided together** (the record can carry the disclosure status). |
**Recommendation: C.** It is the only option that changes what the *record now asserts* without changing what PECL *was shown*. Depends on `attribution_type` existing (WO-HONEST-ATTRIBUTION) — so item 4 and item 3 land together, after that field ships. Nothing suppressed meanwhile.

## OPERATOR RULINGS 2026-08-10 — applied state

1. **RADII — approved + applied.** Geometry reported first (as required): Montney/Horn = `ST_Point` for AREA operations; corridor = `ST_LineString` ✓; LNG/HQ = point (genuinely point-like). Applied to prod `client_geo_assets`: Montney 120→**50**, Horn River 100→**50**, LNG terminal 60→**30**, Calgary HQ 80→**25**, CGL corridor 30→**15** (line buffer). The two `operations_point` assets carry a point, not area geometry — 50 km is **interim**; correct fix = polygon footprint → [[WO-GEO-ASSET-AREA-GEOMETRY]].
2. **ENTITY LIST — WO opened as an over-attribution vector** ([[WO-ENTITY-EXTRACTION-POLLUTION]]). Audit: PECL **1,201 person entities, 1,189 (99%) auto-created** (`created_by=NULL`, mostly `suggested`) — NFL/CFL QBs, political figures, generic nouns. **Feedback loop CONFIRMED (soft form):** wrongly-attributed signals → extracted proper nouns → `suggested` entities → re-injected as `entityContext` into the extraction prompt (biases future linking). **Hard loop absent:** keyword matcher does not key on entity names; `active_monitoring_enabled=0`. Recorded as the **5th instance** of the cheap-proxy class.
3. **`attribution_type` BUILT** (dependency for items 3+4). Append-only ledger `public.signal_client_attributions` (migration `20260810180000`) — `attribution_type ∈ {direct,competitor,sector,none}`, `supersedes` self-FK, `disclosure_status`, RLS-enabled deny-by-default, append-only trigger (UPDATE/DELETE blocked — verified). Items 3 (competitor relabel) + 4 (635 Option C superseding record) now ship together on this substrate.
4. **635 — Option C approved.** Ships as superseding `attribution_type='none'` records after the relabel pass (item 3). Original signals untouched.
5. **Semantic parallel — RUN (item 4). Evidence about the semantic leg, not a re-verdict.**

Ran the **exact** semantic-leg classifier (same `buildPrompt` + `clientContext` + gpt-4o-mini + `CONF_THRESHOLD=0.60` as `classify-shadow-semantic-nightly`; match⇒accept, empty⇒reject) over the stored text of both sets via one-off `semantic-agreement-probe`. Write-isolated, persists nothing.

| Set | evaluated | semantic REJECT | semantic ACCEPT | accept rate | vs deterministic |
|---|---|---|---|---|---|
| **611** (Kilbacks phase-1) | 119 (+1 err) | **115** | 4 | **3.4%** | **STRONG AGREEMENT** — deterministic said 610/611 reject; semantic rejects 96.6% |
| **665** (PECL no-anchor†) | 149 (+1 err) | 115 | **34** | **22.8%** | **MATERIAL DIVERGENCE** — deterministic genuine-PECL accept ~3–7%; semantic ~3× higher |

- **611:** the 4 accepts are all mis-matched to **BC Place** (a stadium — semantic false-positives); **zero recovered any Kilbacks relevance** (`accept_pecl=0`). The semantic leg independently confirms the phase-1 quarantine: no real threat hides in the 611. **Where the answer is clearly noise, semantic agrees.**
- **665:** all 34 accepts went to **PECL** — ~3× the deterministic genuine-accept rate. Reading the accepts shows the divergence is a **MIX**, and that is the whole finding:
  - **Genuine recall** the deterministic matcher structurally *cannot* achieve — e.g. *"…tingkat segmen huluan **Petronas**"* (Malay: boosts Petronas upstream): literally about Petronas, no English keyword to match. The semantic leg is correct and the keyword leg is blind.
  - **Over-association** — *"Public funding warning for LNG projects"* (generic sector), *"[NAAD] severe thunderstorm warning"* (weather), *"Amnesty International … British Columbia"* (BC-generic): the exact over-attribution the exercise is correcting, re-introduced by LLM judgment instead of substring.
- **Conclusion about the semantic leg (the decision input requested):** it is a **recall instrument, not a precision instrument.** It agrees where the answer is clear noise (611) and diverges *toward more attribution* where judgment is required (665) — recovering some real misses **and** re-introducing over-attribution. **Implication for the live gate:** do NOT let it replace the deterministic/geo gate (it would reintroduce over-attribution). It belongs on the **recall side** — surfacing candidates (like the foreign-language Petronas item) that the deterministic + geo + attribution_type layers then confirm/label — never as the sole live authority. The correction lands on the deterministic verdict as planned; this is only evidence about the semantic leg.

† Caveat: the probe's "no-anchor" filter captured **993** PECL rows (broader than the 686 deterministic snapshot — a looser definition), so the 665 rates are **directional**, not an exact bucket match. The direction (semantic ~3× more permissive, mixed recall/over-association) is robust. `semantic-agreement-probe` is a one-off analysis function (operator-invoked, no cron/registry entry — not a phantom); remove when done.
