-- get_adjacent_incidents v2: filter signals by locality.
--
-- v1 returned the last 10 signals for the client regardless of where
-- the signal occurred. For a camp in NE BC, the report ended up
-- including Vancouver protests / global LNG news / Indigenous court
-- rulings from other regions — irrelevant to the specific site's
-- protective-intel picture.
--
-- v2 filters signals to those that mention the asset's locality:
-- match against asset.attributes->>'km_marker', the asset name itself,
-- and the asset's road_access. Signals get a 'matched_by' tag so the
-- report can show why each was included.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_adjacent_incidents(
  p_asset_id  uuid,
  p_radius_km numeric DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geom geometry;
  v_client_id uuid;
  v_asset_name text;
  v_km_marker text;
  v_road_access text;
  v_audits jsonb;
  v_signals jsonb;
  v_search_terms text[];
BEGIN
  SELECT geom, client_id, name,
         attributes->>'km_marker',
         attributes->>'road_access'
  INTO v_geom, v_client_id, v_asset_name, v_km_marker, v_road_access
  FROM public.client_assets WHERE id = p_asset_id;

  IF v_geom IS NULL THEN
    RETURN jsonb_build_object(
      'audits', '[]'::jsonb,
      'signals', '[]'::jsonb,
      'note', 'asset has no geometry; cannot compute proximity'
    );
  END IF;

  -- Sister-site audits within radius — geospatial proximity remains
  -- the gating mechanism here (audits have asset geom).
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_audits
  FROM (
    SELECT a.id, a.completed_at, a.summary_text,
           ca.name AS asset_name, ca.asset_class,
           ROUND((ST_Distance(ca.geom::geography, v_geom::geography) / 1000.0)::numeric, 2) AS distance_km
    FROM public.site_audits a
    JOIN public.client_assets ca ON ca.id = a.asset_id
    WHERE a.client_id = v_client_id
      AND a.id != (SELECT id FROM public.site_audits WHERE asset_id = p_asset_id ORDER BY started_at DESC LIMIT 1)
      AND a.status = 'completed'
      AND a.completed_at > NOW() - INTERVAL '12 months'
      AND ca.geom IS NOT NULL
      AND ST_DWithin(ca.geom::geography, v_geom::geography, p_radius_km * 1000)
    ORDER BY a.completed_at DESC
    LIMIT 20
  ) t;

  -- Build the locality search-term set from the asset's identifying
  -- text. Excludes too-short tokens that would match anywhere.
  v_search_terms := ARRAY[]::text[];
  IF v_asset_name IS NOT NULL AND length(v_asset_name) >= 4 THEN
    v_search_terms := array_append(v_search_terms, v_asset_name);
  END IF;
  IF v_km_marker IS NOT NULL AND length(v_km_marker) >= 2 THEN
    v_search_terms := array_append(v_search_terms, v_km_marker);
  END IF;
  IF v_road_access IS NOT NULL AND length(v_road_access) >= 4 THEN
    v_search_terms := array_append(v_search_terms, v_road_access);
  END IF;

  -- Signals filtered by locality: title / location / normalized_text
  -- must mention at least one of the asset's identifying terms.
  -- Falls back to empty set if no terms (asset is too generic to
  -- match locally — better to return nothing than global noise).
  IF array_length(v_search_terms, 1) > 0 THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_signals
    FROM (
      SELECT s.id, s.created_at, s.title, s.severity, s.signal_type,
             (
               CASE WHEN s.title ILIKE ANY (SELECT '%' || term || '%' FROM unnest(v_search_terms) AS term)
                    THEN 'title'
                    WHEN COALESCE(s.location, '') ILIKE ANY (SELECT '%' || term || '%' FROM unnest(v_search_terms) AS term)
                    THEN 'location'
                    ELSE 'text' END
             ) AS matched_by
      FROM public.signals s
      WHERE s.client_id = v_client_id
        AND s.created_at > NOW() - INTERVAL '12 months'
        AND s.title IS NOT NULL
        AND (
          s.title ILIKE ANY (SELECT '%' || term || '%' FROM unnest(v_search_terms) AS term)
          OR COALESCE(s.location, '') ILIKE ANY (SELECT '%' || term || '%' FROM unnest(v_search_terms) AS term)
          OR COALESCE(s.normalized_text, '') ILIKE ANY (SELECT '%' || term || '%' FROM unnest(v_search_terms) AS term)
        )
      ORDER BY s.created_at DESC
      LIMIT 8
    ) t;
  ELSE
    v_signals := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'radius_km', p_radius_km,
    'asset_name', v_asset_name,
    'search_terms', v_search_terms,
    'audits', v_audits,
    'signals', v_signals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_adjacent_incidents(uuid, numeric)
  TO authenticated, service_role;

COMMIT;
