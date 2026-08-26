# WO-KILBACKS-HOUSEHOLD-CONFIG — correct household protective-intelligence config (PLAN, build on approval)

**Context (operator, 2026-08-10):** Kilbacks is the operator's **family account** — household protective intelligence for the **Okanagan** (Kaleden BC), an **active wildfire region**. The deterministic cutover correctly removed **569 fabricated `Home`/`cabin` substring matches**, but that leaves the household with **zero keyword coverage + 6 entities during fire season** — a real gap the noise was masking. This is the PECL finding from the other direction: PECL had over-broad coverage; Kilbacks has *no correct coverage*.

## Current state (measured)
- **Geography:** `locations = ["380 Whitel lake road Kaleden BC"]` — a full **street address as one free-text string**. Unusable for matching (an article says "Kaleden", not "380 Whitel lake road Kaleden BC") and unusable for proximity (no coordinates). This is *why* every asset-label match failed closed to `geo_pending`.
- **Keywords:** `monitoring_keywords = []` (zero).
- **Assets:** `["Home","cabin"]` — both common-noun, both now retired from text matching (correctly).
- **Entities (6, person, active):** Aaron Kilback, Janis Kilback, Jakob Kilback, Avary Kilback, Barry Kilback, Jennifer Taylor. Five carry `monitoring_context = "threat OR harassment OR doxxing OR stalking OR 'personal information' OR 'home address' OR scam OR impersonation OR 'data breach' OR extortion"`; Jennifer Taylor has none.
- **Quarantined:** 788 Kilbacks signals; **28 mention Okanagan-area place names** (see §4).

## 1. GEOGRAPHY FIRST — exactly what to provide
Replace the single free-text street address with **structured, matchable geography**. For each property provide:
- **Place name(s)** for text matching — the community + nearby named places, not the street address. House: `Kaleden`, `Skaha Lake`, `Okanagan Falls`, `Penticton`, `Regional District Okanagan-Similkameen (RDOS)`. Cabin: its community + nearby named places.
- **Coordinates (lat/lon, decimal degrees, ~5 dp)** for each property — this is what enables **proximity** (radius-based matching against CWFIS wildfire hotspot coordinates and BCWS evacuation-polygon centroids). Precision: property-level is fine; it is not published anywhere, it drives a radius test only.
- **A monitoring radius** per property (proposed **default 30 km**, tunable) — "a wildfire/evac within R km of this point is ours."
- **Format:** a structured `locations`/`geo_assets` shape — `{label, place_names[], lat, lon, radius_km}` per property — NOT a free-text address string. (Schema note: `clients.locations` is `text[]`; proper geo needs a typed store — either a `client_geo_assets` table or a JSONB `geo` column. This is the substrate decision to make at build.)

**Provide to the agent:** the two property coordinates (lat/lon) + the community/place names + preferred radius. That is the whole input; everything else is derivable.

## 2. KEYWORDS — proposed household set (Okanagan principal)
Currently zero. Proposed (operator to edit/approve):
- **Named individuals:** `Aaron Kilback`, `Janis Kilback`, `Jakob Kilback`, `Avary Kilback`, `Barry Kilback`, `Jennifer Taylor` (+ any aliases). *(These also live as entities — keep both: entity path for deep monitoring, keyword path for fast news match.)*
- **Property / area place names:** `Kaleden`, `Skaha Lake`, `Okanagan Falls`, `Naramata`, `Penticton`, `Summerland`, + the two property road/area names, + `RDOS`.
- **School / employer:** the children's school name; the principal's employer/organization. *(operator to supply — not derivable.)*
- **Evacuation / emergency, SCOPED to the places (not province-wide):** `evacuation order Kaleden`, `evacuation alert Okanagan Falls`, `wildfire Kaleden`, `wildfire Skaha`, `structure fire Penticton`, `flood Okanagan`, `state of emergency RDOS`. Scoping to named places is the whole lesson of the PECL finding — never bare `wildfire`/`evacuation`.

## 3. THE WILDFIRE PATH — proximity-anchored, not province-wide
Three sources, each anchored to the Kilbacks coordinates + radius (§1), never "British Columbia":
- **CWFIS hotspots (`monitor-wildfires`)** — already coordinate-based; add the Kilbacks point so a hotspot within R km emits a Kilbacks signal (point-to-point distance, real proximity).
- **BCWS evacuation ORDERS/ALERTS** — the existing `get_bcws_evacuations_near(lat,lng,radius_km)` tool is *exactly* this; wire the household point in so an order/alert whose polygon is within R km emits a signal. **This is the highest-value fire-season signal** (mandatory-leave-now).
- **NAAD emergency alerts** — already composite-scored (the tier-2 lift source); filter NAAD alerts by area overlap with the Kilbacks radius rather than province.
All three replace "province-wide text match" with "distance ≤ R km from the household." This is the region-as-proxy standing rule applied ([[feedback_cheap_proxy_for_expensive_correct_signal]]): geography enters → proximity is **computed**, never inferred.

## 4. RE-EXAMINE THE QUARANTINED SET — real threats discarded as noise?
Of **788** born-quarantined Kilbacks signals, **≥28 mention Okanagan-area place names** and would plausibly pass a proximity test with real geography. Samples pulled: *"Residents flee fast-spreading wildfire", "Support for B.C. Fire Evacuees", "Wildfire Damage", "Destruction of Homes by Wildfire", "Bradley Wildfire Incident / Bradley Creek Fire Destruction"*. **These are exactly the fire-season household intelligence that matters, discarded as `Home`/`cabin` fabrication.** The 28 is a **floor** — it counts only items whose text mentions a place name I searched; a coordinate-radius test against the real property points would refine it (some "Bradley wildfire" items may be within/outside R km). **Build step: once geography exists, run the 788 through a proximity test and report how many are genuine — and un-quarantine those, one-time, on evidence.**

## Sequencing (ahead of the watchdog work, per operator)
1. **Operator provides:** two property coordinates + radius + school/employer names (the only non-derivable inputs).
2. Build: geo substrate (typed geo store) → keywords set → wire the household point into the three wildfire sources → run the 788 proximity re-exam → un-quarantine the genuine ones.
3. This is real coverage during an active fire season — priority over the watchdog cleanup.
