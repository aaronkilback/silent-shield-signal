# WO-CRT-GEO-ASSETS-01 — BC Place (CRT) has zero client_geo_assets

**Logged:** 2026-07-31. **Client:** BC Place (`0bbbbbbb-cccc-4444-bbbb-000000000002`, active, industry `venue_security`).
**Class:** client-aware relevance capability inert for this client. **Not alert-blocking.**

## Finding
`client_geo_assets` for BC Place = **0** (PECL has 5). The Gate-3 asset-proximity relevance path
(place-name → `geo_place_gazetteer` → PostGIS `ST_DWithin` → `client_geo_assets` buffer, RPC
`grounding_resolve_asset_links`) therefore **cannot resolve for BC Place** — no signal can be credited for being
near BC Place infrastructure, because there is no infrastructure geometry to be near. The client-aware relevance
capability does not function for CRT.

## Why it matters
- BC Place is a **venue** (a stadium + its operating perimeter, transit corridors, fan zones, airspace). Its whole
  threat model is geographic/proximity-based (crowd, perimeter, last-mile, airspace) — exactly what Gate-3 exists
  to score. With 0 geo assets, proximity relevance is dead weight for the client it would help most.
- This is **needed before any CRT demo or pilot**: a client-aware relevance demo that silently does no
  client-aware relevance is a false capability (WO-FABRICATED-FINDINGS class — capability advertised, not
  delivered).

## Scope (design, not built here)
1. Populate `client_geo_assets` for BC Place: the stadium footprint (polygon or point+buffer), the operating
   perimeter, key transit nodes / fan-zone areas — geometry from an **authoritative source** (municipal / venue
   GIS), never model-approximated (gazetteer-authoritativeness standing rule 2026-07-31).
2. Verify the resolver credits a BC Place venue-proximate signal after population (same empirical check as the
   PECL third fixture).
3. Confirm the gazetteer covers the relevant place names (Vancouver venue/transit place names) — extend if absent
   (omit, never approximate, if no authoritative entry).

## Dependencies / relationship
- Independent of the alert-emit-seam + incident-quality work (2026-08-01 hold). Unaffected by that hold.
- Same authoritativeness discipline as WO-GAZETTEER-BACKFILL-01.
