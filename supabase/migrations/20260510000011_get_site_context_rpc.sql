-- get_site_context — Phase 1C
--
-- The first canvas-query function. Given a (lat, lng) point, returns:
--   • Containing jurisdictions (polygon layers that contain the point):
--     regional district, fire centre, health authority, municipality,
--     Indian reserve, etc.
--   • Nearby features (point + line layers within p_radius_km):
--     hospitals, pipelines, well sites, etc. — ranked by distance.
--
-- Returns shape: jsonb
--   {
--     "lat": 56.24, "lng": -121.78, "radius_km": 25,
--     "jurisdictions": [
--       { layer, name, sector, external_id, confidence, last_verified_at }
--     ],
--     "nearby": [
--       { layer, name, sector, distance_km, external_id, confidence }
--     ],
--     "summary_text": "Fort St. John RCMP · Northeast Fire Centre · Northern Health · ..."
--   }
--
-- Why a single function: AEGIS calls this once per signal/incident
-- with a location. One round-trip returns everything needed for the
-- snapshot WHERE field, the EB context block, and the agent-chat
-- briefing prelude.
--
-- Why SECURITY DEFINER: world_geographies has RLS allowing
-- authenticated read, but routing through the function lets us add
-- per-layer access control later (e.g. some layers may become
-- per-client-only) without changing every caller.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_site_context(
  p_lat        numeric,
  p_lng        numeric,
  p_radius_km  numeric DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point        geometry;
  v_jurisdictions jsonb;
  v_nearby        jsonb;
  v_summary       text;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'lat and lng required',
      'lat', p_lat,
      'lng', p_lng
    );
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  -- ── Containing jurisdictions: polygon layers covering the point ──
  -- Order: by sector + name so output is stable across calls.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'layer', layer,
      'name', name,
      'sector', sector,
      'external_id', external_id,
      'confidence', confidence,
      'last_verified_at', last_verified_at,
      'source', source,
      'attributes', attributes
    )
    ORDER BY sector, name
  ), '[]'::jsonb)
  INTO v_jurisdictions
  FROM public.world_geographies
  WHERE deleted_at IS NULL
    AND feature_type = 'polygon'
    AND ST_Intersects(geom, v_point);

  -- ── Nearby features: point + linestring within radius ──
  -- Convert to geography for true metric distance. Cap at top 25 to
  -- avoid bloating the response when a query lands in a dense area.
  SELECT COALESCE(jsonb_agg(row_data ORDER BY distance_km), '[]'::jsonb)
  INTO v_nearby
  FROM (
    SELECT jsonb_build_object(
      'layer', layer,
      'name', name,
      'sector', sector,
      'feature_type', feature_type,
      'distance_km', ROUND(ST_Distance(geom::geography, v_point::geography) / 1000.0, 3),
      'external_id', external_id,
      'confidence', confidence
    ) AS row_data,
    ROUND(ST_Distance(geom::geography, v_point::geography) / 1000.0, 3) AS distance_km
    FROM public.world_geographies
    WHERE deleted_at IS NULL
      AND feature_type IN ('point', 'linestring')
      AND ST_DWithin(geom::geography, v_point::geography, p_radius_km * 1000)
    ORDER BY ST_Distance(geom::geography, v_point::geography) ASC
    LIMIT 25
  ) t;

  -- ── Summary text: dot-separated jurisdiction names for narrative ──
  -- This is what the snapshot's WHERE field renders.
  SELECT string_agg(name, ' · ' ORDER BY sector, name)
  INTO v_summary
  FROM (
    SELECT DISTINCT name, sector
    FROM public.world_geographies
    WHERE deleted_at IS NULL
      AND feature_type = 'polygon'
      AND ST_Intersects(geom, v_point)
      AND name IS NOT NULL
  ) t;

  RETURN jsonb_build_object(
    'lat', p_lat,
    'lng', p_lng,
    'radius_km', p_radius_km,
    'jurisdictions', v_jurisdictions,
    'nearby', v_nearby,
    'summary_text', COALESCE(v_summary, 'No canvas coverage at this location'),
    'jurisdiction_count', jsonb_array_length(v_jurisdictions),
    'nearby_count', jsonb_array_length(v_nearby)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_context(numeric, numeric, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_site_context IS
  'Canvas substrate query. Given a lat/lng point, returns containing jurisdictions (polygon layers) + nearby features (point + linestring layers within radius). Used by AEGIS to add geographic context to any signal/incident with a known location.';

COMMIT;
