-- Ingest infrastructure for the canvas substrate.
-- Adds:
--   1. A partial-unique index on (layer, external_id) so the ingest
--      function can ON CONFLICT cleanly. Partial because some sources
--      don't expose a stable external_id and we want to allow those
--      rows in without forcing a sentinel.
--   2. A batch upsert RPC that takes a JSONB array of features and
--      handles GeoJSON → PostGIS geometry conversion server-side. The
--      edge function calls this once per page instead of once per
--      feature, keeping wall-clock time down.
--   3. A small per-layer "soft-touch" RPC that only updates the
--      registry's last_refreshed_at + next_refresh_at after a
--      successful run.

BEGIN;

-- Partial unique index — replaces the non-unique index from the prior
-- migration. Constrained to non-null external_id + non-deleted rows.
DROP INDEX IF EXISTS public.world_geographies_layer_external_id_idx;

CREATE UNIQUE INDEX world_geographies_layer_external_id_uq
  ON public.world_geographies(layer, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- ─── Batch upsert RPC ─────────────────────────────────────────────
-- Input shape: p_features is jsonb array of objects:
--   { "external_id": string|null,
--     "name": string|null,
--     "geometry": <GeoJSON>,
--     "attributes": {...},
--     "source_record_id": string|null }
--
-- Returns counts: { inserted, updated, skipped_invalid_geom }.
--
-- Why server-side: ST_GeomFromGeoJSON requires PostGIS — running it
-- per feature from edge functions over the REST API would be N round
-- trips. This RPC handles the entire page in one call.
CREATE OR REPLACE FUNCTION public.bulk_upsert_world_geographies(
  p_layer       text,
  p_source      text,
  p_source_url  text,
  p_features    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature        jsonb;
  v_inserted       integer := 0;
  v_updated        integer := 0;
  v_skipped        integer := 0;
  v_layer_row      public.world_geography_layers%ROWTYPE;
  v_geom           geometry;
  v_feature_type   text;
  v_external_id    text;
  v_name           text;
BEGIN
  -- Verify layer exists; we don't auto-create.
  SELECT * INTO v_layer_row FROM public.world_geography_layers
   WHERE layer = p_layer;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown layer: %. Add to world_geography_layers first.', p_layer;
  END IF;

  -- Iterate features, upsert each.
  FOR v_feature IN SELECT * FROM jsonb_array_elements(p_features)
  LOOP
    -- Defensively skip any feature without geometry.
    IF v_feature->'geometry' IS NULL OR v_feature->'geometry' = 'null'::jsonb THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_geom := ST_SetSRID(ST_GeomFromGeoJSON(v_feature->>'geometry'), 4326);
    EXCEPTION WHEN OTHERS THEN
      -- Malformed geometry — skip rather than fail the batch.
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    -- Derive feature_type from the geometry (used for indexing/filtering).
    v_feature_type := CASE
      WHEN GeometryType(v_geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
      WHEN GeometryType(v_geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'linestring'
      WHEN GeometryType(v_geom) IN ('POINT', 'MULTIPOINT') THEN 'point'
      ELSE 'polygon'  -- defensive fallback
    END;

    v_external_id := NULLIF(v_feature->>'external_id', '');
    v_name := NULLIF(v_feature->>'name', '');

    IF v_external_id IS NOT NULL THEN
      -- Upsert path: external_id allows ON CONFLICT.
      INSERT INTO public.world_geographies (
        layer, feature_type, name, external_id, geom,
        area_km2, length_km,
        sector, function,
        attributes,
        source, source_url, source_record_id,
        ingested_at, confidence, last_verified_at
      ) VALUES (
        p_layer, v_feature_type, v_name, v_external_id, v_geom,
        CASE WHEN v_feature_type = 'polygon'
             THEN ST_Area(v_geom::geography) / 1000000.0  -- m² → km²
             ELSE NULL END,
        CASE WHEN v_feature_type = 'linestring'
             THEN ST_Length(v_geom::geography) / 1000.0   -- m → km
             ELSE NULL END,
        v_layer_row.sector, NULL,
        COALESCE(v_feature->'attributes', '{}'::jsonb),
        p_source, p_source_url, NULLIF(v_feature->>'source_record_id', ''),
        NOW(), 1.0, NOW()
      )
      ON CONFLICT (layer, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET
        name = EXCLUDED.name,
        geom = EXCLUDED.geom,
        area_km2 = EXCLUDED.area_km2,
        length_km = EXCLUDED.length_km,
        attributes = EXCLUDED.attributes,
        source = EXCLUDED.source,
        source_url = EXCLUDED.source_url,
        ingested_at = NOW(),
        confidence = 1.0,        -- a fresh re-ingest resets to full confidence
        last_verified_at = NOW(),
        updated_at = NOW();

      -- Was it an insert or an update? Check by ingested_at vs created_at.
      -- (Cheap heuristic: if updated_at == created_at within 1s, it was an insert.)
      IF FOUND THEN
        IF (SELECT created_at = updated_at OR (updated_at - created_at) < interval '1 second'
              FROM public.world_geographies
             WHERE layer = p_layer AND external_id = v_external_id) THEN
          v_inserted := v_inserted + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
      END IF;
    ELSE
      -- No external_id — straight insert (no dedup possible).
      INSERT INTO public.world_geographies (
        layer, feature_type, name, geom,
        area_km2, length_km,
        sector,
        attributes,
        source, source_url
      ) VALUES (
        p_layer, v_feature_type, v_name, v_geom,
        CASE WHEN v_feature_type = 'polygon'
             THEN ST_Area(v_geom::geography) / 1000000.0
             ELSE NULL END,
        CASE WHEN v_feature_type = 'linestring'
             THEN ST_Length(v_geom::geography) / 1000.0
             ELSE NULL END,
        v_layer_row.sector,
        COALESCE(v_feature->'attributes', '{}'::jsonb),
        p_source, p_source_url
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'layer', p_layer,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped_invalid_geom', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_world_geographies(text, text, text, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.bulk_upsert_world_geographies(text, text, text, jsonb) FROM PUBLIC;

-- ─── Mark layer refreshed ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_world_geography_layer_refreshed(
  p_layer text,
  p_feature_count integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.world_geography_layers
  SET last_refreshed_at = NOW(),
      next_refresh_at = NOW() + (refresh_cadence_days || ' days')::interval,
      attributes = attributes || jsonb_build_object(
        'last_refresh_feature_count', p_feature_count,
        'last_refresh_at_iso', NOW()::text
      ),
      updated_at = NOW()
  WHERE layer = p_layer;
$$;

GRANT EXECUTE ON FUNCTION public.mark_world_geography_layer_refreshed(text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.mark_world_geography_layer_refreshed(text, integer) FROM PUBLIC;

COMMIT;
