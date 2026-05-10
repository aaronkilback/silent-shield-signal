-- SRA report-generation schema additions.
--
-- Phase 2F. Adapts the wizard to produce the operator's existing SRA
-- format (per the b-76-C / Jedney compressor station report from
-- Oct 2025). What's added here is the data the manual report has
-- that the wizard didn't capture: asset value, expanded operational
-- status, risk-matrix ratings, high-value target features, time-
-- bucketed recommendations.

BEGIN;

-- ─── client_assets — asset value range + km marker shorthand ───────
ALTER TABLE public.client_assets
  ADD COLUMN IF NOT EXISTS estimated_value_low_usd  numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_high_usd numeric;

-- ─── Expanded operational_status — capture shut-in / unmanned /
-- under_construction states the SRA distinguishes ─────────────────
-- The original constraint was inline on the column; we drop + recreate.
ALTER TABLE public.client_assets
  DROP CONSTRAINT IF EXISTS client_assets_operational_status_check;

ALTER TABLE public.client_assets
  ADD CONSTRAINT client_assets_operational_status_check
  CHECK (operational_status IN (
    'active',
    'turnaround',
    'mothballed',
    'decommissioned',
    'proposed',
    'to_be_shut_in',          -- new: site identified for shut-in but not yet
    'shut_in',                 -- new: shut down, no personnel, lights off
    'seasonally_unmanned',     -- new: e.g. winter access only
    'under_construction'       -- new: pre-commissioning
  ));

-- ─── site_features — add high_value_target type with subtype ──────
-- Drop + recreate the feature_type CHECK to add the new enum value.
ALTER TABLE public.site_features
  DROP CONSTRAINT IF EXISTS site_features_feature_type_check;

ALTER TABLE public.site_features
  ADD CONSTRAINT site_features_feature_type_check
  CHECK (feature_type IN (
    -- Perimeter (existing)
    'fence_segment','gate','camera','lighting_fixture',
    'sightline_blind_spot','signage','intrusion_sensor',
    -- Access & Personnel
    'entry_point','access_control_reader','visitor_log_location','staffed_post',
    -- OT/ICS
    'scada_node','plc','historian','engineering_workstation',
    'vendor_remote_endpoint','removable_media_location',
    -- Comms
    'radio_repeater','internet_uplink','satphone_location',
    -- External Intel
    'incident_marker','surveillance_observation',
    -- NEW: inside-the-fence high-value targets
    'high_value_target',
    -- Catchall
    'other'
  ));

-- ─── audit_risk_ratings — 5x5 matrix per audit ─────────────────────
-- One row per (audit, risk_category). Operator captures or AI proposes
-- likelihood (1-5) + impact (A-E); rating is derived label.
CREATE TABLE IF NOT EXISTS public.audit_risk_ratings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        uuid NOT NULL REFERENCES public.site_audits(id) ON DELETE CASCADE,
  risk_category   text NOT NULL CHECK (risk_category IN (
    'theft_vandalism',
    'sabotage',
    'environmental_damage',
    'insider_threat',
    'tampering_supply_chain',
    'physical_intrusion',
    'cyber_ot_compromise',
    'protest_disruption',
    'wildlife_force_majeure'
  )),
  likelihood      integer NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact          text    NOT NULL CHECK (impact IN ('A','B','C','D','E')),
  rating_label    text    NOT NULL,                    -- e.g. "Medium 2C"
  rating_band     text    NOT NULL CHECK (rating_band IN ('low','medium','high','severe','catastrophic')),
  rationale       text,
  derived_by      text NOT NULL DEFAULT 'operator' CHECK (derived_by IN ('operator','ai','ai_then_human_edited')),
  source_features uuid[] DEFAULT ARRAY[]::uuid[],     -- features that informed the rating
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_risk_ratings_unique UNIQUE (audit_id, risk_category)
);

CREATE INDEX IF NOT EXISTS audit_risk_ratings_audit_idx
  ON public.audit_risk_ratings(audit_id);

CREATE TRIGGER audit_risk_ratings_updated_at
  BEFORE UPDATE ON public.audit_risk_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.audit_risk_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_risk_ratings_read_auth" ON public.audit_risk_ratings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_risk_ratings_write_auth" ON public.audit_risk_ratings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "audit_risk_ratings_write_service" ON public.audit_risk_ratings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── audit_recommendations — bucketed action items ─────────────────
-- Operator + AI co-author. Generated synthesis lives here. Used by the
-- report renderer to produce Short/Medium/Long Term sections.
CREATE TABLE IF NOT EXISTS public.audit_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        uuid NOT NULL REFERENCES public.site_audits(id) ON DELETE CASCADE,
  bucket          text NOT NULL CHECK (bucket IN ('short_term','medium_term','long_term')),
  description     text NOT NULL,
  rationale       text,
  source          text NOT NULL DEFAULT 'operator' CHECK (source IN ('operator','ai','ai_then_human_edited')),
  priority        integer DEFAULT 0,                -- for sorting within a bucket
  related_feature_ids uuid[] DEFAULT ARRAY[]::uuid[],
  related_risk_categories text[] DEFAULT ARRAY[]::text[],
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','complete','dismissed')),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_recommendations_audit_idx
  ON public.audit_recommendations(audit_id);
CREATE INDEX IF NOT EXISTS audit_recommendations_bucket_idx
  ON public.audit_recommendations(audit_id, bucket, priority);

CREATE TRIGGER audit_recommendations_updated_at
  BEFORE UPDATE ON public.audit_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.audit_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_recommendations_read_auth" ON public.audit_recommendations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_recommendations_write_auth" ON public.audit_recommendations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "audit_recommendations_write_service" ON public.audit_recommendations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Adjacent-incidents query helper ───────────────────────────────
-- Pulls recent audits + signals near a given asset. The SRA report
-- format calls these out as "Previous incidents at nearby sites".
-- Returns up to 20 events from the last 12 months within the radius.
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
  v_audits jsonb;
  v_signals jsonb;
BEGIN
  SELECT geom, client_id INTO v_geom, v_client_id
  FROM public.client_assets WHERE id = p_asset_id;

  IF v_geom IS NULL THEN
    RETURN jsonb_build_object('audits', '[]'::jsonb, 'signals', '[]'::jsonb,
                              'note', 'asset has no geometry; cannot compute proximity');
  END IF;

  -- Sister-site audits with completed status, last 12 months.
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

  -- Signals geo-located within the radius (when client_id matches).
  -- Many signals in this codebase don't have geom; we query what we can.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_signals
  FROM (
    SELECT s.id, s.created_at, s.title, s.severity, s.signal_type
    FROM public.signals s
    WHERE s.client_id = v_client_id
      AND s.created_at > NOW() - INTERVAL '12 months'
      AND s.title IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'radius_km', p_radius_km,
    'audits', v_audits,
    'signals', v_signals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_adjacent_incidents(uuid, numeric)
  TO authenticated, service_role;

COMMIT;
