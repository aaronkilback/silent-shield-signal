-- ═══════════════════════════════════════════════════════════════════════
-- WORLD GEOGRAPHIES CANVAS — substrate Phase 1A
-- ═══════════════════════════════════════════════════════════════════════
--
-- This migration stands up the geospatial substrate that AEGIS reads
-- from to produce situational-aware briefings. It is the "canvas" half
-- of the May 8 architecture (canvas + per-client footprint). Per-client
-- assets land in a separate `client_assets` table in Phase 2 — this
-- migration is for the public, jurisdiction-level layers that exist
-- regardless of which client is reading them.
--
-- DESIGN PRINCIPLES (committed by the May 10 design pass):
--
-- 1. ONE table holds polygons, lines, and points via a single
--    `geometry(Geometry, 4326)` column. Indexed via GIST. Industry
--    standard; avoids the "table per geometry type" anti-pattern.
--
-- 2. EVERY row carries provenance: source, source_url,
--    source_record_id. Without it the substrate decays into trivia.
--
-- 3. EVERY row has a confidence + last_verified_at. The model is never
--    "done" — it's a living asset that ages without re-verification.
--    Per-row `refresh_cadence_days` says how often the source should
--    be re-pulled.
--
-- 4. SOFT-DELETE only. Substrate rows are referenced by signals,
--    incidents, and (later) site_observations. Hard-delete would
--    orphan downstream evidence.
--
-- 5. A separate `world_geography_layers` registry tracks what data
--    sources exist, when they were last refreshed, and what cadence
--    they should run on. The watchdog can read this to flag stale
--    layers without inspecting individual rows.

BEGIN;

-- ─── PostGIS extension ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Layer registry (lookup table for ingest cadence + provenance) ─
CREATE TABLE IF NOT EXISTS public.world_geography_layers (
  layer                  text PRIMARY KEY,
  display_name           text NOT NULL,
  description            text,
  sector                 text NOT NULL,
  -- 'law_enforcement' | 'fire' | 'health' | 'energy' | 'transport' |
  -- 'admin' | 'environment' | 'utilities'

  source                 text NOT NULL,
  source_url             text,
  refresh_cadence_days   integer NOT NULL DEFAULT 90,
  geometry_type          text NOT NULL,
  -- 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString' |
  -- 'Point' | 'MixedFeature'

  last_refreshed_at      timestamptz,
  next_refresh_at        timestamptz,
  is_active              boolean NOT NULL DEFAULT true,

  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.world_geography_layers IS
  'Registry of public geospatial datasets that the canvas pulls from. One row per layer (e.g. RCMP detachments, BC fire service areas). Tracks source provenance + refresh cadence. The watchdog reads this to flag stale layers.';

-- ─── Geographies (the substrate) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.world_geographies (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  layer                  text NOT NULL REFERENCES public.world_geography_layers(layer),
  feature_type           text NOT NULL CHECK (feature_type IN ('polygon', 'linestring', 'point')),
  name                   text,
  external_id            text,

  -- Geometry — single column handles all types via GIST index
  geom                   geometry(Geometry, 4326) NOT NULL,
  -- Precomputed metrics for cheap sort/filter (avoid ST_Area in hot paths)
  area_km2               numeric,
  length_km              numeric,

  -- Hierarchy + jurisdiction context
  parent_id              uuid REFERENCES public.world_geographies(id) ON DELETE SET NULL,
  jurisdiction           text,
  -- 'federal' | 'provincial' | 'territorial' | 'regional' | 'municipal' | 'indigenous'
  jurisdiction_name      text,

  -- Sector + function (denormalized from layer for direct query)
  sector                 text,
  function               text,
  -- 'response' | 'jurisdiction' | 'infrastructure' | 'asset' | 'overlay'

  -- Source-specific arbitrary fields (commander name, station address, etc.)
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance
  source                 text NOT NULL,
  source_url             text,
  source_record_id       text,
  ingested_at            timestamptz NOT NULL DEFAULT NOW(),

  -- Confidence + freshness
  confidence             numeric NOT NULL DEFAULT 1.0
                         CHECK (confidence >= 0 AND confidence <= 1),
  last_verified_at       timestamptz NOT NULL DEFAULT NOW(),

  -- Soft-delete (substrate rows are referenced — hard-delete would orphan)
  deleted_at             timestamptz,

  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.world_geographies IS
  'The canvas substrate. Polygon/line/point geographic features that AEGIS queries to understand the world a signal lands in. Sourced from government open data + OSM. Per-client overlays land in client_assets (Phase 2).';

-- ─── Indexes ───────────────────────────────────────────────────────
-- GIST on geometry — required for ST_Intersects, ST_DWithin, ST_Contains
CREATE INDEX IF NOT EXISTS world_geographies_geom_gix
  ON public.world_geographies USING GIST(geom);

-- Layer + sector + function for filtered scans
CREATE INDEX IF NOT EXISTS world_geographies_layer_idx
  ON public.world_geographies(layer) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS world_geographies_sector_idx
  ON public.world_geographies(sector) WHERE deleted_at IS NULL;

-- External-id lookup (used by ingest scripts to upsert by source's own ID)
CREATE INDEX IF NOT EXISTS world_geographies_layer_external_id_idx
  ON public.world_geographies(layer, external_id) WHERE external_id IS NOT NULL;

-- Name search via trigram (operator + agent fuzzy match)
CREATE INDEX IF NOT EXISTS world_geographies_name_trgm_idx
  ON public.world_geographies USING GIN(name gin_trgm_ops) WHERE name IS NOT NULL;

-- Confidence-decay surfacing query: "rows below threshold needing re-verify"
CREATE INDEX IF NOT EXISTS world_geographies_confidence_idx
  ON public.world_geographies(confidence) WHERE deleted_at IS NULL;

-- ─── Auto-update updated_at on row modification ────────────────────
CREATE OR REPLACE FUNCTION public.touch_world_geographies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS world_geographies_touch_updated ON public.world_geographies;
CREATE TRIGGER world_geographies_touch_updated
  BEFORE UPDATE ON public.world_geographies
  FOR EACH ROW EXECUTE FUNCTION public.touch_world_geographies_updated_at();

DROP TRIGGER IF EXISTS world_geography_layers_touch_updated ON public.world_geography_layers;
CREATE TRIGGER world_geography_layers_touch_updated
  BEFORE UPDATE ON public.world_geography_layers
  FOR EACH ROW EXECUTE FUNCTION public.touch_world_geographies_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────
-- Substrate is readable by any authenticated user (it's public-info canvas
-- data). Writes are restricted to service-role only — the ingest functions
-- and the (Phase 3) drift-queue accept/reject UI are the only writers.
ALTER TABLE public.world_geographies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_geography_layers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "world_geographies_read_all_auth" ON public.world_geographies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "world_geographies_write_service" ON public.world_geographies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "world_geography_layers_read_all_auth" ON public.world_geography_layers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "world_geography_layers_write_service" ON public.world_geography_layers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Seed the 5 Phase-1 layers ─────────────────────────────────────
-- Each row stakes out the layer in the registry so the ingest functions
-- (Phase 1B) have a target to upsert against. is_active=true means the
-- layer is part of the active canvas; the ingest scheduler reads from
-- this list. Refresh cadence is per-layer because RCMP boundaries shift
-- rarely (~yearly) while pipelines change with permits (~monthly).

INSERT INTO public.world_geography_layers (
  layer, display_name, description, sector, source, source_url,
  refresh_cadence_days, geometry_type, notes
) VALUES
  ( 'rcmp_detachment',
    'RCMP Detachment Boundaries',
    'Royal Canadian Mounted Police detachment service areas across Canada. Used for jurisdictional response-time estimation and "which detachment covers this site" lookups.',
    'law_enforcement',
    'Statistics Canada / RCMP Open Data',
    'https://www150.statcan.gc.ca/n1/en/catalogue/police-services',
    365,
    'MultiPolygon',
    'Boundaries are stable year-over-year; quarterly refresh sufficient. Watch for detachment realignment announcements (rare).'
  ),
  ( 'bc_fire_service_area',
    'BC Fire Department / Service Areas',
    'Service area boundaries for fire departments and protection areas in British Columbia. Used to estimate fire-response coverage at client sites.',
    'fire',
    'BC GeoBC (Office of the Fire Commissioner)',
    'https://catalogue.data.gov.bc.ca/dataset/fire-protection-service-areas',
    180,
    'MultiPolygon',
    'Updated roughly twice a year as new fire departments form or service areas shift.'
  ),
  ( 'bc_regional_district',
    'BC Regional Districts',
    'Regional district boundaries — the unit of regional governance in BC, between province and municipality. Critical for community engagement scoping.',
    'admin',
    'BC GeoBC (Statutory Boundaries)',
    'https://catalogue.data.gov.bc.ca/dataset/regional-districts-legally-defined-administrative-areas-of-bc',
    365,
    'MultiPolygon',
    'Annual refresh sufficient — boundaries change only by legislation.'
  ),
  ( 'bcer_pipeline',
    'BC Energy Regulator Pipelines',
    'Active and proposed pipelines under BCER (formerly BCOGC) jurisdiction. Used for proximity analysis to client linear assets and for incident correlation.',
    'energy',
    'BC Energy Regulator OpenData',
    'https://data-bc-er.opendata.arcgis.com/',
    30,
    'MultiLineString',
    'Pipelines change with permit issuance — monthly refresh recommended.'
  ),
  ( 'bcer_well_site',
    'BC Energy Regulator Well Sites',
    'Active oil and gas wells permitted under BCER. Used for proximity analysis to client wells and adjacent-operator awareness.',
    'energy',
    'BC Energy Regulator OpenData',
    'https://data-bc-er.opendata.arcgis.com/',
    30,
    'Point',
    'High change rate as wells are spudded and abandoned — monthly refresh.'
  )
ON CONFLICT (layer) DO NOTHING;

-- ─── Verify ────────────────────────────────────────────────────────
SELECT
  'postgis_version' AS metric,
  PostGIS_Version() AS value
UNION ALL
SELECT
  'layers_seeded',
  COUNT(*)::text
FROM public.world_geography_layers
UNION ALL
SELECT
  'geographies_count',
  COUNT(*)::text
FROM public.world_geographies;

COMMIT;
