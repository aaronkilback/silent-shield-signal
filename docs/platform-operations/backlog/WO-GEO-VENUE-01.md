# WO-GEO-VENUE-01 — geo-anchoring for the venue archetype

**Logged 2026-08-12. Do not start (logged per operator ruling). Scope before any client-facing venue demo.**

## Finding
BC Place is a **fixed address** (BC Place Stadium, 777 Pacific Blvd, Vancouver). Distance from Pacific Boulevard is a **stronger relevance signal than keyword matching** — a signal geolocated near the venue is relevant regardless of whether it names a monitored keyword, and a Whitecaps sports result far from the venue is not, even though it matches a keyword (see STEP 3 dry-run: "Whitecaps exit Leagues Cup" matched "direct" but is not a venue security signal).

## Why it's ready
`client_geo_assets` + PostGIS + `score_signal_hazard_pathway` already exist from the wildfire work (BC Place already has a geo asset: BC Place Stadium, 2km, added 2026-08-12). The proximity leg the D6 gate uses could anchor venue relevance the same way it anchors wildfire proximity.

## Scope (when started)
Give the venue archetype geo-anchored relevance: proximity to `client_geo_assets` as a first-class relevance signal alongside (or above) keyword matching. Distinguishes "near the venue" from "names a keyword." Complements re-attribution (attribution) with proximity (relevance). Do before a client-facing venue demo.
