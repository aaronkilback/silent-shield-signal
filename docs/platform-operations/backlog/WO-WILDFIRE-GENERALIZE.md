# WO-WILDFIRE-GENERALIZE — assess the existing wildfire engine before building a Kilbacks path (ASSESSMENT, do not build)

> **STATUS 2026-08-11 — ✅ CLOSED (cluster 4 of 5). Cutover DONE + acceptance CORRECTED + proven.**
>
> **Acceptance criterion CORRECTED by operator (2026-08-11):** the gate was set as "same-signals parity" — that was **wrong, and the operator revised it** (their call to make, not mine). Passing same-signals parity would have required **reproducing the over-attribution**. The right test is **correct-subset**: the proximity function must catch 100% of genuinely-proximate fires and **drop** distant non-threats. (Recorded: KB `feedback-acceptance-criterion-correct-subset`. I held the cutover when the criterion changed rather than interpreting around it — see also the number-vs-intent divergence below.)
>
> **What was done:**
> 1. **D2 radii** (already in place, re-confirmed): HQ 25km, operations_point 50km, LNG terminal 30km. CGL corridor **15 → 30km** (operator: a 670km linear asset carries a wider buffer than a point; recovers fires at 21–28km).
> 2. **9 gas plants folded** into `client_geo_assets` as `asset_type='gas_plant'`, `buffer_km=30` (McMahon, Younger, Jedney, Caribou, Lily, Sunrise, Aitken Creek, Fort Nelson, Taylor). PECL now 14 geo-assets. These do real work — 5 covered fires would have been missed without them.
> 3. **Old `monitor-wildfires` cron (jobid 178) PAUSED** (`cron.alter_job(178, active:=false)` — schedule row kept, code kept, reversible). **De-registered** from `cron_job_registry` (else Registry-is-a-Promise phantom). `monitor-geo-wildfire-30min` (jobid 237) is **sole PECL wildfire authority**.
> 4. **Watchdog references trimmed** (system-watchdog, deployed): removed stale `MONITOR_SOURCE_MAP` + `CRON_TO_AGENT` entries, redirected agent-dispatch to `monitor-geo-wildfire-30min`.
>
> **Replay proof (30 historical PECL BCWS fires, centroid-based):** 30 → **18 COVERED** (nearest 5.2km → 45.5km, all within an asset buffer) / **12 DROPPED** (35km … **208km**). The dropped set is regional over-attribution the old function made via `explicit_client_override` with the AI recording *"proximity Infinity km"* — see the 208km finding (`project-geo-anchoring-208km-overinclusion`). New function catches every genuinely-proximate fire; drops only distant non-threats. **Correct-subset parity: PROVEN.**
>
> **Number-vs-intent divergence (recorded, `feedback-operator-number-vs-intent-divergence`):** operator ruled "widen to 25km" AND "recover R11011 (27.6km)" in the same sentence — 27.6 > 25, so 25km can't do it. The pre-pause verification gate caught it (16→17, not the specified 18); surfaced the divergence rather than silently picking the number or the intent; operator confirmed intent (30km). Verified 18/12 at 30km, nothing ≥35km moved.
>
> **Customer-visible change (disclosure — goes with the 635 conversation):** PECL **stops receiving fire signals for fires 20–208km away**. This is a reduction in volume and an increase in accuracy.
>
> **Follow-on (NOT a new WO per Rule 1 — tracked here):** BCWS-endpoint-health re-instrumentation. The 2b watchdog probe (BCWS FeatureServer reachability) is DORMANT post-cutover — `monitor-geo-wildfire` doesn't emit `bcws_fires_fetch_ok`/`bcws_evacs_fetch_ok` because `_shared/bcws.ts` swallows fetch errors. To restore: expose fetch-ok from `_shared/bcws.ts`, write the booleans in `monitor-geo-wildfire`, re-key the probe to `monitor-geo-wildfire-30min`. Also: the `/wildfire` VIEWER retirement stays scoped (separate, deliberate). And `operations_point`-at-50km is still a point-proxy for an area — the polygon fix (WO-GEO-ASSET-AREA-GEOMETRY) stays scoped.
>
> **Reversal path:** `cron.alter_job(178, active:=true)` + re-INSERT the `cron_job_registry` row (`monitor-wildfires`, 15min, critical) + revert the watchdog trims.


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
- ✅ **Items 1-5 BUILT as the small rewrite (`monitor-geo-wildfire`, ~200 lines) — deployed, cron-registered, LIVE-VERIFIED.** Iterates `client_geo_assets` via `client_geo_points()` RPC (ST_Centroid for non-point PECL geom) → `findBCWSEvacuationsNear` + `findBCWSActiveFiresNear` + CWFIS-household. Framing by asset_type; item-1 household gate (households never suppressed). Output contract fires correctly (proven: it failed loudly when emits were broken). Registered cron `13,43 * * * *`, is_critical, attempt-heartbeat-before-gate, validator ✅ PASS. **Live run: 15 emitted, 0 errors, 52s — Kilbacks got 3 real signals incl. an evacuation 4.3 km from the children's school + a Fire of Note 26 km out.** Kilbacks (item 4) is LIVE now, ahead of PECL parity per operator. Two gotchas fixed live: `ST_Y needs POINT` (→ ST_Centroid); `ingest-signal` 404 "Source not found" on unregistered `source_key` (→ omit it); `supabase.functions.invoke` returned non-2xx (→ direct service-role `fetch`).
- ⏳ **PARITY WINDOW (open):** old `monitor-wildfires` still LIVE (cron NOT paused). PECL parity is low-volume (0 bcws_active_fire in 7d) so a quiet window proves nothing — establish via HISTORICAL REPLAY against past fires, not a live wait. Old paused (not deleted) once parity holds; viewer retirement scheduled after.
- **Verification owed:** PECL count+attribution before/after same window; Kilbacks live run of all 3 sources against real coords (or plainly "quiet, nothing active within 30 km today"); the synthetic test (done, item 1).

## SCOPE REASSESSMENT (2026-08-10, operator: the /wildfire page has no users)
Traced the actual dependency graph — and it changes the build shape:

1. **Does the viewer need to survive the refactor? No — it's DECOUPLED from the emitter.** The page (`WildfirePortal.tsx`), `simulate-fire-spread`, `generate-wildfire-daily-report` (manual-only, **no cron**), and the wildfire agent tools (`agent-tools-wildfire.ts`, wired into `agent-tools-core`) are **separate files**. `monitor-wildfires` writes nothing the page reads. Retiring the viewer removes the `/wildfire` route + the fire-spread sim + the daily report + the AI's wildfire tools — all unused per operator — and is **independent of the emitter refactor**. Not on the critical path; a separate cleanup that removes coupling.
2. **Does anything besides PECL's signal feed consume `monitor-wildfires` output? No.** It writes **only `signals` + `signal_updates`.** So the parity gate is exactly **"PECL's signals unchanged"** — and that surface is **SMALL:** identifiable emitter output for PECL = **~14 `bcws_active_fire`/30d (0 in the last 7d)** + lightning/CWFIS. The bulk of PECL's "wildfire" signals (**376/30d**) are **NEWS** (tier2:wildfire, the RSS path — NOT this emitter). The 1,533 lines produce a few dozen signals a month.
3. **How much of the 1,533 lines is page vs emission?** ~0% is page (page is separate). It is **all emitter + enrichment** — but most is **NE-BC/industrial enrichment machinery** (FWI/FBP fire behaviour, NASA FIRMS overlay, weather-station lookups, perimeter point-in-polygon, lightning correlation, flaring classification) wrapped around a small output.

### Honest recommendation — REWRITE the emitter small; do not refactor the 1,533 lines
**A clean client-agnostic emitter (~200 lines) is simpler to write than refactoring the existing one.** Shape: iterate `client_geo_assets` → `findBCWSEvacuationsNear` + `findBCWSActiveFiresNear` + CWFIS hotspot distance (`ST_DWithin`) → emit proximity signals; **keep the item-1 `classifyHotspot` flaring gate for industrial `asset_type` only** (PECL's flare-suppression value); framing by asset_type; output contract. Leave the old `monitor-wildfires` **DORMANT behind the flag** (or its cron paused) during a parity window, then retire it + the unused viewer separately. Parity is small and mechanical (reproduce PECL's ~14 bcws_active_fire + evac + hotspot signals from the substrate). This is the operator's own conclusion, confirmed by the graph: **a small correct function beats a carefully-preserved large one nobody needs.**

## Recommendation — ONE client-agnostic engine, off the shared substrate
Generalize `monitor-wildfires`: geography + attribution from `client_geo_assets` (`ST_DWithin`), flaring/industrial logic gated to industrial `asset_type`, framing by asset type. Retire `OPS_BBOX` / `ZONE_LOCATION_KEYWORDS` / the duplicated `INDUSTRIAL_FACILITIES` (fold PECL's facilities into `client_geo_assets` as industrial-typed rows). Reuse the client-agnostic core that already exists (`bcws.ts`, CWFIS WFS). Output contract (operator): BCWS ORDER within a client's radius + nothing emitted = FAILURE. **This serves Kilbacks AND PECL from one path — do not build a parallel household monitor.** SCOPE recorded; build on approval.
