# Backlog (DEFERRED): persistent-heat-source flaring-corroboration layer

**Raised:** 2026-07-29 (WO-FLARE-DISAMBIGUATION Phase 2 item 2) · **Status: DEFERRED with trigger condition.**

## The design (operator's, held)

A registered persistent-heat-source layer on client facilities (flare stacks, plant thermal). Satellite-thermal signals within its buffer route to a **CORROBORATION-PENDING** state — reported as "thermal anomaly at [facility] — consistent with operational flaring, monitoring for corroboration," awareness-adjacent, never main-tier and never suppressed. Independent corroboration (BCWS listing, news, NAAD, social) → immediate promotion to highest-priority main-tier. Uncorroborated after [TBD]h → logged as flaring-consistent, feeding a **flaring-activity trendline** (itself client-relevant intel — flaring frequency is PECL's own reputational story per the 3Si benchmark reports). Doctrine corollary: **proximity makes a signal ELIGIBLE for main-tier; corroboration makes it TRUE.**

## Why DEFERRED

Phase 1 evidence: the flare produces **zero signals today**. The LNG Canada Terminal is in `monitor-wildfires` `INDUSTRIAL_FACILITIES` (54.017, -128.630); detections within 4 km are classified `industrial_flaring` and do **not** create signals (console-logged only, April-2026 rule). Base rate: **0 terminal-proximate (≤10 km) hotspots in 90 days.** Building corroboration machinery for a non-manifesting problem waits — the coordinate-first fix (Phase 2 item 1, shipped) already removed the actual false-positive (region-name text-geocoding), and it did so without needing this layer.

## TRIGGER CONDITION (build it when this fires)

Build the corroboration layer **if/when a terminal-proximate thermal signal actually appears post-coordinate-fix** — i.e. a `monitor-wildfires` (or future raw-CWFIS-hotspot) signal with `geo_precision='source-coordinates'` scoring ≤10 km from a registered persistent-heat-source facility. That is the moment proximity-without-corroboration becomes real and the "eligible vs true" machinery earns its keep. Until then: tracked, not built.

**Watch query (candidate Sentinel/watchdog probe):** `hazard_pathway_scores` where `geo_precision='source-coordinates'` AND `distance_km <= 10` AND `nearest_asset` is a persistent-heat-source facility → if count > 0, trigger this backlog.

Related: `docs/reports/WO-FLARE-DISAMBIGUATION-phase1-2026-07-29.md`, pathway-scoring doctrine.
