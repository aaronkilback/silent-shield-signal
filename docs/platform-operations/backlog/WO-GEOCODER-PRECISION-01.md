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
