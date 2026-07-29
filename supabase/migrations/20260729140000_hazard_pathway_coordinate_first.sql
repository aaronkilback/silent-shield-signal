-- WO-FLARE Phase 2 item 1: coordinate-first hazard pathway scoring (applied prod 2026-07-29).
-- Uses source coordinates (raw_json.centroid) when present; gazetteer text-geocode is fallback
-- only, tagged geo_precision='text-derived'. Adds hazard_pathway_scores.geo_precision.
-- Full function body applied via MCP (hazard_pathway_coordinate_first). Re-score evidence:
-- 13 Kitimat-attributed fires (were text-derived 0km MAIN) -> 3 stay MAIN via CGL corridor
-- (5-28km), 10 drop to awareness (67-208km). See docs/reports/WO-FLARE-DISAMBIGUATION-phase1.
alter table public.hazard_pathway_scores add column if not exists geo_precision text;
