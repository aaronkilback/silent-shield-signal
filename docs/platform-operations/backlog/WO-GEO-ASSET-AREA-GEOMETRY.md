# WO-GEO-ASSET-AREA-GEOMETRY — area operations must carry geometry, not a point + generous radius (SCOPE, do not build)

**Operator ruling 2026-08-10 (item 1 condition):** "A field operation spanning 40km with a 50km point radius covers very different ground depending on where the point sits. If they are areas, they should carry geometry, not a point plus a generous radius — same argument as the corridor buffer."

## Measured state (prod, 2026-08-10)
| Asset | asset_type | geometry it HAS | radius (retuned 2026-08-10) | correct model |
|---|---|---|---|---|
| Montney / Fort St. John upstream | operations_point | **`ST_Point`** | 50 km (interim) | **`Polygon`/`MultiPolygon`** of the play footprint + small buffer |
| Horn River / Fort Nelson upstream | operations_point | **`ST_Point`** | 50 km (interim) | **`Polygon`/`MultiPolygon`** footprint + small buffer |
| LNG Canada terminal (Kitimat) | lng_terminal | `ST_Point` | 30 km | point OK (a fixed facility is genuinely point-like) |
| Calgary HQ | hq_office | `ST_Point` | 25 km | point OK |
| Coastal GasLink corridor | pipeline_corridor | **`ST_LineString`** ✓ | 15 km buffer | already correct — line + buffer |

**The corridor is the model to copy:** a linear/area asset carries real geometry and `ST_DWithin` buffers the *shape*, not an arbitrary center point. The two upstream operations are areas (Montney play, Horn River basin) stored as single points — the 50 km is an honest *interim* tightening, but it is still the cheap proxy ([[feedback_cheap_proxy_for_expensive_correct_signal]], region-as-proxy family): a proximity test against one point in a ~tens-of-km play is geometrically wrong regardless of radius.

## Fix shape (scope, do not build)
1. **Source the footprints.** Montney / Horn River play or PECL tenure/licence-area polygons (BC OGC / Petronas public tenure maps) → `Polygon`/`MultiPolygon` in EPSG:4326.
2. **Replace point+radius with geometry+small-buffer** for the two `operations_point` assets; keep `buffer_km` as a *proximity margin around the shape* (e.g. 10-15 km "near the play"), not a stand-in for the play's own extent.
3. **`client_geo_points()` RPC already handles non-point geometry** via `ST_Centroid` — the emitter path (`monitor-geo-wildfire`) needs no change; only the stored geometry changes.
4. **Re-run the 20 geo/proximity accepts** against the corrected geometry — the operational-proximity accepts (Montney/Fort Nelson/Chetwynd) should hold or tighten; report if the number moves.

## APPLIED ≠ SOLVED (operator ruling 2026-08-10, item 4)
**Montney and Horn River at 50 km from a POINT is still a cheap proxy for an area — just a tighter one.** The interim retune (120/100→50) reduces the over-broad geo false positives, but it does NOT make the proximity test geometrically correct: a single point cannot represent a play that spans tens of km, at any radius. **The real fix is polygon geometry (§ Fix shape below), and it is scoped, not done.** Do not let "radii applied 2026-08-10" read as "geo proximity for the upstream assets is solved" — it is not. Same anti-pattern, one tightening short of correct ([[feedback_cheap_proxy_for_expensive_correct_signal]]).

## Priority
Interim 50 km is applied and is a strict improvement over 120/100 km. This WO is the *correct* fix, not urgent — but it is the difference between "near a point we picked" and "near the actual operation." Sequence after the entity + attribution work; it improves geo accept precision. **State remains: interim proxy applied, correct geometry OUTSTANDING.**

**SCOPE only. Do not build.** Interim (proxy) radii applied 2026-08-10 — NOT the fix. Recorded 2026-08-10.
