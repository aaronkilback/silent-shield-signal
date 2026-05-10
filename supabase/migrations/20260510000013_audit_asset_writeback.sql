-- Audit-driven asset writeback + lat/lng update RPC.
--
-- Phase 2C: when an operator confirms a fact in Stage 1 (criticality,
-- operational status, lat/lng), the wizard already writes a
-- site_observations row. This migration adds the second writeback
-- target: client_assets itself, so the canonical state is kept fresh
-- in lockstep with the audit record. The observation is the audit
-- trail; the asset row is the queryable state.
--
-- Two functions:
--   1. update_client_asset_from_audit  — multi-field updater the
--      wizard calls once per stage commit.
--   2. set_client_asset_geom           — sets the Point geometry from
--      lat/lng. Separate because it requires PostGIS conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_client_asset_from_audit(
  p_asset_id              uuid,
  p_audit_id              uuid,
  p_criticality_tier      text DEFAULT NULL,
  p_operational_status    text DEFAULT NULL,
  p_attributes_patch      jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset client_assets%ROWTYPE;
  v_audit site_audits%ROWTYPE;
  v_changed jsonb := '{}'::jsonb;
BEGIN
  -- Verify audit + asset are linked + audit is in-progress.
  -- This prevents an old completed audit's edits from clobbering a
  -- newer state.
  SELECT * INTO v_audit FROM public.site_audits
   WHERE id = p_audit_id AND asset_id = p_asset_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found, not in progress, or not linked to asset %', p_audit_id, p_asset_id;
  END IF;

  SELECT * INTO v_asset FROM public.client_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found', p_asset_id;
  END IF;

  IF p_criticality_tier IS NOT NULL AND p_criticality_tier <> COALESCE(v_asset.criticality_tier, '') THEN
    UPDATE public.client_assets
       SET criticality_tier = p_criticality_tier, updated_at = NOW()
     WHERE id = p_asset_id;
    v_changed := v_changed || jsonb_build_object('criticality_tier',
      jsonb_build_object('from', v_asset.criticality_tier, 'to', p_criticality_tier));
  END IF;

  IF p_operational_status IS NOT NULL AND p_operational_status <> v_asset.operational_status THEN
    UPDATE public.client_assets
       SET operational_status = p_operational_status, updated_at = NOW()
     WHERE id = p_asset_id;
    v_changed := v_changed || jsonb_build_object('operational_status',
      jsonb_build_object('from', v_asset.operational_status, 'to', p_operational_status));
  END IF;

  IF p_attributes_patch IS NOT NULL THEN
    UPDATE public.client_assets
       SET attributes = attributes || p_attributes_patch, updated_at = NOW()
     WHERE id = p_asset_id;
    v_changed := v_changed || jsonb_build_object('attributes_patched', p_attributes_patch);
  END IF;

  RETURN jsonb_build_object('asset_id', p_asset_id, 'changed', v_changed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_client_asset_from_audit(uuid, uuid, text, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_client_asset_geom(
  p_asset_id  uuid,
  p_audit_id  uuid,
  p_lat       numeric,
  p_lng       numeric,
  p_accuracy_m numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit site_audits%ROWTYPE;
BEGIN
  -- Same authorization gate as the writeback above.
  SELECT * INTO v_audit FROM public.site_audits
   WHERE id = p_audit_id AND asset_id = p_asset_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found, not in progress, or not linked to asset %', p_audit_id, p_asset_id;
  END IF;

  UPDATE public.client_assets
  SET geom = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
      attributes = attributes || jsonb_build_object(
        'last_geom_capture_accuracy_m', p_accuracy_m,
        'last_geom_capture_at', NOW()::text
      ),
      updated_at = NOW()
  WHERE id = p_asset_id;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'lat', p_lat, 'lng', p_lng,
    'accuracy_m', p_accuracy_m
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_client_asset_geom(uuid, uuid, numeric, numeric, numeric)
  TO authenticated, service_role;

COMMIT;
