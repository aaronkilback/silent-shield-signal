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

## Pending (not corrected — per operator "report before correcting")
- **Semantic parallel run** (batch LLM over both sets) — for agreement only; the correction lands on the deterministic verdict. NOT run in this pass.
- **No correction applied.** Awaiting operator ruling on: the 665's ~635 rejects (born-quarantine / re-attribute?), the 28 competitor (relabel via WO-HONEST-ATTRIBUTION), the 20 proximity (keep — defensible), the 3 keyword (keep + fix the anchor regex).
