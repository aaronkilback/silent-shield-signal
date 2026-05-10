-- Add source-config + attributes to world_geography_layers, populate the
-- WFS feature type names confirmed against BC GeoBC's openmaps.gov.bc.ca
-- WFS service. The ingest function reads `source_config` to know which
-- WFS feature type to fetch + which properties to map to canvas fields.
--
-- Why this column shape:
--   • source_config (jsonb) holds source-specific knobs (WFS feature
--     type, field-name mappings, srs, paging size). Keeping it as one
--     jsonb avoids schema churn as we add layers from new sources.
--   • One layer == one source for Phase 1. If a layer ever needs to
--     stitch from multiple sources, that's a separate `composite_layer`
--     concept introduced later.

BEGIN;

ALTER TABLE public.world_geography_layers
  ADD COLUMN IF NOT EXISTS source_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attributes    jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.world_geography_layers.source_config IS
  'Source-specific ingest configuration. For BC GeoBC WFS layers: { wfs_feature_type, name_field, external_id_field, page_size, srs }. The ingest function reads this to drive its fetch + parse loop.';

-- ─── Update seeded layers with confirmed BC GeoBC WFS feature types ──
-- Discovered from openmaps.gov.bc.ca/geo/pub/wfs?request=GetCapabilities
-- on 2026-05-10. These are the canonical layer names BC GeoBC publishes.

UPDATE public.world_geography_layers
SET
  source_url = 'https://openmaps.gov.bc.ca/geo/pub/wfs',
  source_config = jsonb_build_object(
    'wfs_feature_type', 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_REGIONAL_DISTRICTS_SP',
    'name_field', 'ADMIN_AREA_NAME',
    'external_id_field', 'LGL_ADMIN_AREA_ID',
    'page_size', 100,
    'srs', 'EPSG:4326',
    'expected_features', 28
  )
WHERE layer = 'bc_regional_district';

UPDATE public.world_geography_layers
SET
  -- Reframe: BC GeoBC publishes Wildfire Service Fire Centres
  -- (operational regions of BC Wildfire Service), not municipal fire
  -- departments. Renaming the layer to match what's actually loaded.
  display_name = 'BC Wildfire Service Fire Centres',
  description = 'BC Wildfire Service operational fire centre boundaries. Used for wildfire-response jurisdiction at client sites in forested or wildland-urban interface zones.',
  source = 'BC GeoBC (BC Wildfire Service)',
  source_url = 'https://openmaps.gov.bc.ca/geo/pub/wfs',
  source_config = jsonb_build_object(
    'wfs_feature_type', 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.DRP_MOF_FIRE_CENTRES_SP',
    'name_field', 'MOF_FIRE_CENTRE_NAME',
    'external_id_field', 'MOF_FIRE_CENTRE_ID',
    'page_size', 100,
    'srs', 'EPSG:4326',
    'expected_features', 6
  )
WHERE layer = 'bc_fire_service_area';

UPDATE public.world_geography_layers
SET
  display_name = 'BC Energy Regulator Pipeline Permits',
  description = 'Active and proposed pipeline installations under BCER (formerly BCOGC) jurisdiction. Used for proximity correlation with client linear assets and incident attribution.',
  source = 'BC GeoBC (BC Energy Regulator)',
  source_url = 'https://openmaps.gov.bc.ca/geo/pub/wfs',
  source_config = jsonb_build_object(
    'wfs_feature_type', 'pub:WHSE_MINERAL_TENURE.OG_PIPELINE_INSTLN_PERMIT_SP',
    'name_field', 'PIPELINE_NAME',
    'external_id_field', 'PIPELINE_INSTLN_ID',
    'page_size', 500,
    'srs', 'EPSG:4326'
  )
WHERE layer = 'bcer_pipeline';

UPDATE public.world_geography_layers
SET
  display_name = 'BC Energy Regulator Well Facilities',
  description = 'Permitted oil and gas well facilities in BC. Used for adjacent-operator awareness and proximity-based incident correlation.',
  source = 'BC GeoBC (BC Energy Regulator)',
  source_url = 'https://openmaps.gov.bc.ca/geo/pub/wfs',
  source_config = jsonb_build_object(
    'wfs_feature_type', 'pub:WHSE_MINERAL_TENURE.OG_WELL_FACILITY_PERMIT_SP',
    'name_field', 'WELL_NAME',
    'external_id_field', 'WELL_FACILITY_ID',
    'page_size', 1000,
    'srs', 'EPSG:4326'
  )
WHERE layer = 'bcer_well_site';

-- RCMP detachments aren't in BC GeoBC WFS (they're a federal layer).
-- Statistics Canada publishes them via the Police Service Areas
-- catalogue, but the file is shapefile-only and has to be downloaded
-- and reprojected. Defer to a per-layer note; will be loaded via a
-- one-shot script rather than the generic ingest function.
UPDATE public.world_geography_layers
SET
  source_url = 'https://www.rcmp-grc.gc.ca/en/detachments',
  notes = COALESCE(notes, '') || ' Note: not exposed via BC GeoBC WFS. Phase 1B loads this from a one-shot script using the StatsCan Police Service Areas dataset (shapefile, requires offline conversion).',
  source_config = jsonb_build_object(
    'requires_offline_conversion', true,
    'note', 'Boundaries available from StatsCan Police Service Areas catalogue as shapefile. Convert to GeoJSON locally + load via separate script. Once loaded, refresh annually.'
  )
WHERE layer = 'rcmp_detachment';

-- ─── Add a few additional high-value BC GeoBC layers spotted in the
--     capabilities scan that we should load alongside the original 5 ──
INSERT INTO public.world_geography_layers (
  layer, display_name, description, sector, source, source_url,
  refresh_cadence_days, geometry_type, source_config, notes
) VALUES
  ( 'bc_municipality',
    'BC Municipalities',
    'Legally-defined municipal boundaries in British Columbia. Critical for jurisdiction routing (which city hall + bylaw + municipal police if applicable).',
    'admin',
    'BC GeoBC (Statutory Boundaries)',
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    365,
    'MultiPolygon',
    jsonb_build_object(
      'wfs_feature_type', 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_MUNICIPALITIES_SP',
      'name_field', 'ADMIN_AREA_NAME',
      'external_id_field', 'LGL_ADMIN_AREA_ID',
      'page_size', 100,
      'srs', 'EPSG:4326',
      'expected_features', 162
    ),
    NULL
  ),
  ( 'bc_indian_reserve',
    'BC First Nations Reserves',
    'Indian reserve boundaries in British Columbia. Critical for community-engagement scoping, consultation jurisdiction, and identifying when client activity touches Indigenous lands.',
    'admin',
    'BC GeoBC',
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    365,
    'MultiPolygon',
    jsonb_build_object(
      'wfs_feature_type', 'pub:WHSE_ADMIN_BOUNDARIES.ADM_INDIAN_RESERVES_BANDS_SP',
      'name_field', 'BAND_NAME',
      'external_id_field', 'OBJECTID',
      'page_size', 200,
      'srs', 'EPSG:4326'
    ),
    'Boundary type "indigenous" — one of the highest-value substrate layers for protective intelligence in BC. Cross-references with monitoring of First Nations consultation outcomes.'
  ),
  ( 'bc_health_authority',
    'BC Health Authority Boundaries',
    'Regional health authority service area boundaries. Used to identify which health authority covers a client site for medical-emergency routing.',
    'health',
    'BC GeoBC',
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    365,
    'MultiPolygon',
    jsonb_build_object(
      'wfs_feature_type', 'pub:WHSE_ADMIN_BOUNDARIES.BCHA_HEALTH_AUTHORITY_BNDRY_SP',
      'name_field', 'HLTH_AUTHORITY_NAME',
      'external_id_field', 'HLTH_AUTHORITY_ID',
      'page_size', 50,
      'srs', 'EPSG:4326',
      'expected_features', 7
    ),
    NULL
  ),
  ( 'bc_hospital',
    'BC Hospitals',
    'Hospital point locations across BC. Used for nearest-hospital + estimated-EMS-time at client sites.',
    'health',
    'BC GeoBC',
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    365,
    'Point',
    jsonb_build_object(
      'wfs_feature_type', 'pub:WHSE_IMAGERY_AND_BASE_MAPS.GSR_HOSPITALS_SVW',
      'name_field', 'HOSPITAL_NAME',
      'external_id_field', 'CUSTODIAN_ORG_NAME',
      'page_size', 500,
      'srs', 'EPSG:4326'
    ),
    NULL
  )
ON CONFLICT (layer) DO NOTHING;

-- Verify
SELECT layer, display_name, sector, refresh_cadence_days,
       (source_config->>'wfs_feature_type') AS wfs_layer,
       (source_config->>'expected_features') AS expected
FROM public.world_geography_layers
ORDER BY sector, layer;

COMMIT;
