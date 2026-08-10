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

## Pending (not corrected — per operator "report before correcting")
- **Semantic parallel run** (batch LLM over both sets) — for agreement only; the correction lands on the deterministic verdict. NOT run in this pass.
- **No correction applied.** Awaiting operator ruling on: the 665's ~635 rejects (born-quarantine / re-attribute?), the 28 competitor (relabel via WO-HONEST-ATTRIBUTION), the 20 proximity (keep — defensible), the 3 keyword (keep + fix the anchor regex).
