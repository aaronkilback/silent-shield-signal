# WO-WILDFIRE-GENERALIZE — assess the existing wildfire engine before building a Kilbacks path (ASSESSMENT, do not build)

**Operator 2026-08-10:** before building a household wildfire path, assess whether the existing `/wildfire` engine generalizes. It does **not** as-is — it is a PECL/NE-BC/industrial feature carrying its own geography — but its data-source core is reusable, and the right build is to make it client-agnostic off `client_geo_assets`, NOT a parallel path. (I removed the parallel `monitor-household-wildfire` I had started — never committed/deployed.)

## 1. What it actually does
- **`monitor-wildfires`** (cron every 15 min, **emits signals**): pulls **CWFIS hotspots** (`hotspots_last24hrs` WFS) + **NASA FIRMS MODIS** + **CWFIS perimeters** (`m3_polygons_current`) + **lightning** (`lightning_obs_24h`), all over a fixed **`OPS_BBOX = -130,50.5,-113,60`**. For each thermal anomaly it classifies **wildfire vs industrial flaring** (distance to 9 hardcoded gas plants + FWI/HFI/season), and emits **lightning / wildfire / ambiguous_near_facility / evacuation** signals via `ingest-signal`, attributed to a target client. Also reuses `_shared/bcws.ts` (`findBCWSActiveFiresNear`, `findBCWSEvacuationsNear`, danger rating).
- **`/wildfire` (`WildfirePortal.tsx`)** is a **VIEWER**, not an emitter — map + data panel + `simulate-fire-spread` projection + agent tools (`agent-tools-wildfire.ts`). It visualizes; it does not create coverage.
- `generate-wildfire-daily-report` — user-triggered HTML report (also over the PECL zone).

## 2. Is PECL hardcoded? Yes — three ways
- **`OPS_BBOX`** (`-130,50.5,-113,60`) — NE-BC + Calgary. **The Okanagan is OUTSIDE it** (Kaleden 49.37 N < minLat 50.5). Kilbacks is not even in the scan area.
- **`INDUSTRIAL_FACILITIES`** — 9 hardcoded PECL gas plants with coordinates (McMahon, Younger, Jedney, Caribou, Lily, Sunrise, Aitken Creek, Fort Nelson, Taylor), used for flaring exclusion.
- **`ZONE_LOCATION_KEYWORDS`** — client selection filters `clients.locations` on NE-BC place-name substrings (fort st john, fort nelson, dawson creek, chetwynd, tumbler ridge, …). **No Okanagan/Kaleden/Penticton → Kilbacks can never be selected.**
- Plus NE-BC gazetteer + industrial signal framing ("operational areas", "pipeline infrastructure", "gas facilities and right-of-way corridors", "reputational and operational exposure").
- Not a `client_id` constant — but region-hardcoded in bbox + facilities + client filter. **A PECL feature, not a proximity engine with PECL wired in as a caller.**

## 3. Does it use `client_geo_assets` + `ST_DWithin`? No — and that's the duplication
- It carries its **own** geography (`OPS_BBOX` + `INDUSTRIAL_FACILITIES` + `clients.locations` string matching). It does **not** touch `client_geo_assets` or `ST_DWithin`.
- **Yet PECL's assets are ALREADY in `client_geo_assets`** (operations_point ×2, hq_office, lng_terminal, pipeline_corridor — the WO-HAZARD-RELEVANCE PostGIS substrate). So PECL's geography is **duplicated**: hardcoded in `monitor-wildfires` AND in the shared table. The substrate is *available* but *not used here*. → **Not a config change; a structural refactor.**

## 4. What would it take to point at Kilbacks?
**Not** best-case-a-client-row — Kaleden is outside the bbox and the location filter. Structurally PECL-shaped. The generalization:
1. **Geography from `client_geo_assets`, not `OPS_BBOX`** — compute the scan bbox as the union of all client geo points, so the Okanagan (and anywhere else) is covered; attribute each hotspot/fire/evac to whichever client has an asset **within its `buffer_km`** via `ST_DWithin`/distance (retire `ZONE_LOCATION_KEYWORDS`).
2. **Flaring classification only for industrial `asset_type`** — a household has no flares; worse, the off-season "industrial override" could mis-classify a real house-threatening Okanagan fire as industrial. Households skip flaring entirely.
3. **Framing by `asset_type`** — neutral household language ("… km from your Kaleden residence / your children's school") vs the industrial "operational area / pipeline corridor" copy.
Then Kilbacks needs only its `client_geo_assets` rows (already stored: house/cabin/school, 30 km) — no code per client.

## 5. Schedule+emit vs page
`monitor-wildfires` **is** a scheduled emitter (15 min) — so a generalized version genuinely **solves the ongoing coverage gap**. The `/wildfire` page is only a viewer. As-is the emitter excludes the Okanagan, so today it does **not** cover Kilbacks.

## 6. Wrong-for-a-household logic
- Industrial **flaring classification** + `INDUSTRIAL_FACILITIES` exclusion (+ off-season "HFI<2000 → industrial" override — could suppress a real winter/shoulder household fire signal).
- **Corridor / "pipeline infrastructure operational area"** framing.
- Facility **operational thresholds** (FRP/HFI/FACILITY_MATCH_KM) assume a gas plant.
- "Reputational and operational exposure" language — a family faces a life-safety threat, not reputational exposure.

## BUILD STATUS (greenlit 2026-08-10)
- ✅ **Item 1 — flaring gate DONE + PROVEN (live).** `classifyHotspot` now takes `{assetType, seasonOverride}`; `isIndustrialAssetType()` — default/unknown = industrial (PECL bbox behaviour UNCHANGED, byte-identical); a **non-industrial (household) context returns `wildfire` before ANY industrial heuristic** (off-season override, flare-signature, FIRMS-static, facility proximity all bypassed). Self-test `?selftest=household_flaring` (emits nothing): a hotspot 5 km from the Kaleden house, off-season, HFI 1500 → **household context = wildfire (emits); legacy default = industrial_flaring (suppressed); PASS=true.** The exact suppression danger, neutralized for households, provable, PECL unaffected. Deployed prod.
- ⏳ **Item 2 — geography from `client_geo_assets` via `ST_DWithin`** (retire OPS_BBOX / ZONE_LOCATION_KEYWORDS / hardcoded facilities; fold PECL's 9 gas plants into `client_geo_assets` as industrial rows). **PECL PARITY is the hard gate — same signals, same attribution, before/after, or it doesn't cut over.** NEXT.
- ⏳ **Item 3 — framing by asset_type** (household = life-safety/evac/access; industrial = operational/reputational).
- ⏳ **Item 4 — output contract** (BCWS order/alert in a client's radius + nothing emitted = FAILURE; registered cron; attempt heartbeat before gate).
- ⏳ **Item 5 — enable Kilbacks** (geo rows already stored — the easy part once 1-4 land).
- **Verification owed:** PECL count+attribution before/after same window; Kilbacks live run of all 3 sources against real coords (or plainly "quiet, nothing active within 30 km today"); the synthetic test (done, item 1).

## Recommendation — ONE client-agnostic engine, off the shared substrate
Generalize `monitor-wildfires`: geography + attribution from `client_geo_assets` (`ST_DWithin`), flaring/industrial logic gated to industrial `asset_type`, framing by asset type. Retire `OPS_BBOX` / `ZONE_LOCATION_KEYWORDS` / the duplicated `INDUSTRIAL_FACILITIES` (fold PECL's facilities into `client_geo_assets` as industrial-typed rows). Reuse the client-agnostic core that already exists (`bcws.ts`, CWFIS WFS). Output contract (operator): BCWS ORDER within a client's radius + nothing emitted = FAILURE. **This serves Kilbacks AND PECL from one path — do not build a parallel household monitor.** SCOPE recorded; build on approval.
