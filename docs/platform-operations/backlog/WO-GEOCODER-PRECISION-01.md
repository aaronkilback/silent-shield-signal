# WO-GEOCODER-PRECISION-01 — gazetteer/geocoding precision defects (independent of any axis decision)

**Status:** Logged 2026-08-14. Real defects surfaced by the offline geo-admit measurement; they exist regardless of whether any geo-admission axis is ever built. They already affect `score_signal_hazard_pathway`'s post-admission scoring today.

## Defects
1. **City-centroid resolution swallows incidental mentions.** `geo_place_gazetteer` resolves a city to ONE downtown point. Any signal that merely mentions the city geocodes to that point. Where a client asset sits in that city (Calgary HQ, BC Place Stadium), every incidental mention lands ≤2km → false proximity. (Measured: 183 "Vancouver" items → BC Place @1.8km; ~130 "Calgary" items → Calgary HQ @1.0km — cat videos, Stampede 50/50, pop-up restaurants.)
2. **Substring matching, no token/entity boundary.** `position(g.name in text)` matches:
   - "Vancouver **Island**" → matches "vancouver" (100+km away, wrong point).
   - "**Taylor** Farms recalls jalapeno" / "**Taylor** Swift" → matches Taylor BC (a NE-BC town co-located with PECL's Taylor Gas Plant).
3. **No event-location extraction.** The geocoder matches ANY place name in the text, not the location the event is actually ABOUT.

## Why it matters independent of axis decisions
`score_signal_hazard_pathway` uses this same gazetteer text-geocode as its fallback when a signal has no coordinates. So these defects already inflate/misplace hazard-pathway scores on admitted signals today — not just in the hypothetical admission door.

## Not proposing a fix here
Candidate directions (for later triage): token-boundary matching (same lesson as the keyword matcher's `.includes('home')`→"homeless" fix), entity/context disambiguation (Taylor town vs surname), de-prioritizing bare city-centroid hits, multi-place resolution preferring the most specific. No build now.

## Same defect, a third column: clients.locations (found 2026-08-14, PECL re-attribution)
`clients.locations` (and by extension any consumer that anchors on it) carries the identical centroid-collision + region-as-proxy shape:
- **Broad-region proxies as location values:** "British Columbia" (fires on 313 PECL signals), "Alberta" (146), "Northeast BC" (11) — a region-as-proxy anchor, the same thing removed from monitoring_keywords.
- **Town names anchor on town-general news:** "Peace River" (162 — it is also a *weather forecast region*, so it matches every Environment Canada Peace River warning), "Fort St. John" (90 — matched a UBC graduation, real-estate listings, a Highway 97 crash), "Kitimat" (61), "Dawson Creek" (15 — a rail-maintainer job ad).
Not fixed here (PECL re-attribution ruled keyword-only, locations excluded). But **any future consumer reading `clients.locations` as a relevance/attribution anchor inherits this** — it needs the same token-boundary + specificity + geo-disambiguation treatment as the gazetteer. Same finding, third column (keywords → gazetteer → locations).
