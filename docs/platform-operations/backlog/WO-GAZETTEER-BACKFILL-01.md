# WO-GAZETTEER-BACKFILL-01 — verify & attribute the 22 legacy gazetteer rows

**Status:** DONE except 1 (calgary). **Opened + executed:** 2026-07-31. **Provenance:** WO-GROUNDING-01 standing rule.
**Ordering:** must complete BEFORE WO-GATE3-PROXIMITY-WEIGHT-01 (replaying against unverified coords → unreliable numbers).

## What / why
22 legacy `geo_place_gazetteer` rows carried coordinates of unknown provenance covering every high-volume place in
the system. Verified each against BC Geographical Names (BCGN), assigned `bcgn_id`, snapped geom to the authoritative
point, removed rows without an authoritative match, and resolved duplicate keys.

## Delta findings (legacy vs BCGN authoritative)
**No coordinate-drift scoring defect for BC places** — all 20 BC rows matched BCGN within **≤2.2 km** (max Vancouver
2.2, Kimberley/Old Fort 1.6, rest <1). Legacy coords were approximately correct (2-decimal ≈1km precision), just
un-attributed. All 19 distinct BC rows snapped to authoritative geom + `bcgn_id`.

## Duplicate keys
`fort st john` and `fort st. john` → the **same** BCGN feature (`/3602`). Removed the no-period variant. To make
resolution **independent of spelling**, `grounding_resolve_asset_links` now strips punctuation on BOTH sides of the
match (`regexp_replace(...,'[^a-z0-9 ]','')`), so one `fort st. john` row matches `Fort St John`, `Fort St. John`,
etc. No other punctuation/spacing duplicates found among the 22.

## Out-of-BCGN (Alberta) — BCGN is BC-only
- **`peace river` — REMOVED.** Legacy coord (56.23,-117.29) is the Alberta TOWN; BCGN has no matching BC town (its
  only "Peace River" is the *Regional District*, 339 km away — a spurious match, NOT a coordinate drift). Ambiguous
  (AB town vs the Peace River itself vs the removed PRRD region). Re-add correctly later (river line geometry, or
  the PRRD polygon per the region-polygon follow-up), or as the AB town via a non-BCGN authoritative source.
- **`calgary` — OPEN (still un-attributed).** Legit + needed (PECL "Calgary HQ" asset, 35 signal mentions/30d) and
  unambiguous, but Alberta → not in BCGN, and GeoNames demo is rate-limited (no account). **NOT removed** (removing
  it would degrade a real asset's proximity coverage). **Blocker: an authoritative Alberta source** — a GeoNames
  application account, or Alberta Geographical Names / GeoDiscover Alberta. Column semantics generalize to
  "authoritative gazetteer id" (BCGN for BC; store `geonames:<id>` for out-of-province). **Operator decision:**
  provide GeoNames creds / accept an alternate authoritative source, or remove calgary per the strict rule.

## Result
Gazetteer **33 rows; 32 with authoritative `bcgn_id`; 1 (calgary) pending**. Resolver spelling-insensitive.
