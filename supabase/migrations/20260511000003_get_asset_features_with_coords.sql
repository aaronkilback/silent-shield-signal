-- get_asset_features_with_coords RPC.
--
-- PostgREST returns geometry columns as hex EWKB strings by default,
-- which the frontend can't decode without a parser library. This RPC
-- decodes the asset's centroid + each feature's geom into plain lat/lng
-- numerics so the wizard can group features by compass quadrant
-- (N / NE / E / SE / S / SW / W / NW) relative to the asset centroid.
--
-- The site-audit-wizard groups a 22-feature perimeter inventory by type
-- today. Spatial grouping is the next-better view: north-side features
-- list together because that's the order the operator saw them on the
-- walk. Spatial gaps ('south side has fence but no camera') become
-- obvious.
--
-- ST_Centroid handles both Point geoms (most features) and LineString
-- geoms (fence_segments captured as walked GPS tracks).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_asset_features_with_coords(
  p_asset_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_lat numeric;
  v_asset_lng numeric;
  v_features  jsonb;
BEGIN
  SELECT
    CASE WHEN geom IS NOT NULL THEN ST_Y(ST_Centroid(geom))::numeric END,
    CASE WHEN geom IS NOT NULL THEN ST_X(ST_Centroid(geom))::numeric END
  INTO v_asset_lat, v_asset_lng
  FROM public.client_assets WHERE id = p_asset_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.feature_type, t.label NULLS LAST), '[]'::jsonb)
  INTO v_features
  FROM (
    SELECT
      f.id,
      f.asset_id,
      f.feature_type,
      f.label,
      f.bearing_deg,
      f.attributes,
      f.primary_photo_url,
      f.confidence,
      f.half_life_days,
      f.last_verified_at,
      f.last_verified_by,
      f.last_verified_audit_id,
      f.created_audit_id,
      f.source,
      f.created_at,
      f.updated_at,
      CASE WHEN f.geom IS NOT NULL THEN ST_Y(ST_Centroid(f.geom))::numeric END AS lat,
      CASE WHEN f.geom IS NOT NULL THEN ST_X(ST_Centroid(f.geom))::numeric END AS lng
    FROM public.site_features f
    WHERE f.asset_id = p_asset_id
      AND f.deleted_at IS NULL
  ) t;

  RETURN jsonb_build_object(
    'asset_lat', v_asset_lat,
    'asset_lng', v_asset_lng,
    'features', v_features
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_asset_features_with_coords(uuid)
  TO authenticated, service_role;

COMMIT;
