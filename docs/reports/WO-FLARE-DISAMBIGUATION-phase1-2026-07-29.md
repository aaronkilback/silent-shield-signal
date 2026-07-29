# WO-FLARE-DISAMBIGUATION — Phase 1 Evidence

**Date:** 2026-07-29 · **Scope:** prod `kpuqukppbmwebiptqmog` · **Status:** EVIDENCE ONLY — no logic changes. Phase 2 HELD.

**Operator finding under test:** the "Kitimat/Skeena 0km" wildfires the WO-HAZARD acceptance test scored as a main-tier WIN may be LNG Canada's persistent flare (documented heat source), not fire.

**Headline — the instinct is right, the mechanism is different (and bigger):** the flare is *already* suppressed and produces ZERO signals. The signals that got promoted are **real, BCWS-corroborated fires 68–146 km away**, mis-placed at "0 km terminal" by the pathway scorer's **text-geocoding of region names** — it ignored the actual coordinates present in each signal. The false-positive the acceptance test scored as a win is **coarse geocoding, not flaring.**

---

## 1. What the promoted signals are (source / coords / confidence)

All 13 pathway=MAIN "LNG Canada terminal 0 km" signals are `signal_origin = monitor-wildfires`, split by source:

- **7 × `bcws_active_fire`** — BCWS-listed active fires with real fire numbers (R51287, R41118, G41095, G41092, R81064, R11011, R31306), `fire_url` to `wildfiresituation.nrs.gov.bc.ca`. **Human-confirmed listings, not raw VIIRS pixels.** Confidence 0.75–1.0.
- **6 × `bcws_evacuation`** — BCWS/First-Nations evacuation alerts (e.g. "Coyote Creek Fire Area", Gitwangak First Nation, `evacId=31`). Also human-issued, not pixels.

**None are raw VIIRS hotspots.** **None are flaring.** Critically, every one carries **real coordinates in `raw_json.centroid`** (I initially checked the wrong key `raw_json.lat`, which is null). Examples:
- `0E916EDE` (Coyote Creek evac): centroid **55.02, -128.31** → **~110 km NE** of the terminal (up Highway 16 / Skeena).
- `526449D4` (BCWS R51287): centroid **55.92, -128.91** → **~200 km N** ("Orenda FSR"); size **0.009 ha (90 m²)**, agent_review verdict `flag` — "severity/size contradiction."

**The "0 km" is a geocoding artifact:** the WO-HAZARD scorer geocoded the place-name text "Kitimat"/"Skeena" via the gazetteer to the terminal point (0 km) and **never used the real centroid.**

## 2. Cross-check verdict

**Real fires, corroborated, NOT flaring, NOT terminal-proximate.** These are genuine BCWS-listed active fires and First-Nations evacuation alerts (independent human corroboration by definition) in the broad Skeena/Kitimat operational zone — but they are **68–146 km from the LNG terminal**, not at it. The flaring hypothesis does not apply to *these* signals; the defect is that distant-but-real fires were scored as 0-km-at-asset because of text-geocoding. (So the operator's stated auto-pull condition — "uncorroborated VIIRS-only" — is **not met**; these are corroborated. See Phase 2.)

## 3. Base rate at the actual terminal (90 days)

55 `monitor-wildfires` signals with coordinates in 90 d, distance to the real terminal (54.05, -128.65):

| Band | Signals | Range | Sources |
|---|---|---|---|
| **≤ 10 km (terminal-proximate / flare-suspect)** | **0** | — | — |
| 10–60 km (within seeded buffer) | 1 | 43 km | bcws_active_fire |
| 60–150 km (Skeena corridor, NOT terminal) | 12 | 68–146 km | bcws_active_fire, bcws_evacuation |
| > 150 km (far) | 42 | 151–795 km | bcws_active_fire, bcws_evacuation |

**Zero terminal-proximate hotspots in 90 days.** Reason: the terminal is in `monitor-wildfires` `INDUSTRIAL_FACILITIES` (`LNG Canada Terminal`, 54.017, -128.630); detections within 4 km are classified `industrial_flaring` and, per the April-2026 rule, **do not create signals** (console-logged only). **So the flare is already suppressed at the monitor level — it is not currently producing false signals.** The 12 mis-geocoded "corridor" signals are the actual promoted set; their real distance is 68–146 km.

---

## Correction to the acceptance-test "win"

The WO-HAZARD acceptance test recorded "Kitimat/Skeena wildfires → MAIN (0 km from LNG terminal)" as correct. The operator was right to challenge it, but for a deeper reason than flaring: **those fires are 68–146 km away; the scorer text-geocoded a 200-km-wide region name to a single facility point.** The acceptance test validated a geocoding artifact. Two distinct false-positive classes exist:
1. **(Active) Text-geocoding a region to a point** — real-but-distant fires scored as 0-km-at-asset. This is what fired here.
2. **(Latent) Facility-proximate thermal = flaring** — sound doctrine, but currently produces zero signals because `monitor-wildfires` already suppresses <4 km industrial flaring. A belt-and-suspenders concern if that suppression ever changes or a raw-hotspot feed is added.

---

## PHASE 2 — HELD FOR RULING

Surfaced, not implemented:

1. **Coordinate-first pathway scoring (the immediate fix).** When a hazard signal carries `raw_json.centroid` (BCWS/CWFIS all do), score PostGIS distance from the **real coordinates**, not the gazetteer place-name. Gazetteer geocoding is a fallback only when no coordinates exist. This alone re-scores the 12 corridor signals to their true 68–146 km — beyond the 60 km terminal buffer (→ corridor/awareness, not 0-km-MAIN). The 43-km one stays legitimately within-buffer.
2. **The flaring-disambiguation layer (operator's design) — still valid as doctrine**, but for the latent class: a registered persistent-heat-source layer routing genuinely terminal-proximate thermal to CORROBORATION-PENDING. Given zero such signals today (already suppressed upstream), this is lower urgency than the geocoding fix, and belongs as the "proximity makes ELIGIBLE, corroboration makes TRUE" corollary once coordinate-first scoring lands.
3. **Auto-pull decision:** the 12 signals are corroborated (not uncorroborated-VIIRS), so the operator's stated auto-pull trigger is not met — but they ARE mis-scored at MAIN via bad geocoding. Ruling needed: re-score with real coordinates (recommended) vs leave pending Phase-2 logic.

**Ledger:** the operator caught a false-positive class the WO-HAZARD acceptance test scored as a win — correctly identified as facility-proximity error, though the root cause is region-name text-geocoding overriding real coordinates, not flaring. The flare itself is already contained upstream. Real catch; the fix is coordinate-first scoring, with the flaring layer as its corollary.
