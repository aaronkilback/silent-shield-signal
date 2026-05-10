-- Site features + media assets + storage bucket.
--
-- Phase 2D substrate. Two new tables + one bucket.
--
-- 1. site_features — persistent per-asset inventory of physical
--    features (fence segments, gates, cameras, lighting fixtures,
--    SCADA nodes, etc.). Compounds across audits. Each audit
--    verifies / updates / adds features. last_verified_at decays a
--    feature's confidence so stale features get prompted for re-shoot.
--
-- 2. media_assets — uploaded photos / documents with EXIF parsed
--    into structured columns. Each photo stamps lat/lng/bearing/
--    altitude/captured_at/pitch/roll/software_app — the moat is
--    every photo becomes a verified ground-truth datum.
--
-- 3. site-audit-media bucket — private, 7-day signed URLs (per
--    CLAUDE.md storage convention).
--
-- Why two tables:
--   • site_features = canonical state ("Camera #3 is at X,Y facing 247°")
--   • media_assets  = audit trail ("on May 10 the operator photographed
--                                 Camera #3 from this angle, this is
--                                 the photo")
--   A feature can have many photos over many audits. A photo can
--   evidence a feature, a stage observation, or stand alone.

BEGIN;

-- ─── site_features — persistent inventory ──────────────────────────
CREATE TABLE IF NOT EXISTS public.site_features (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                    uuid NOT NULL REFERENCES public.client_assets(id) ON DELETE CASCADE,

  feature_type                text NOT NULL CHECK (feature_type IN (
    -- Perimeter
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
    -- Catchall
    'other'
  )),
  label                       text,                         -- "Camera #3 NW"
  geom                        geometry(Geometry, 4326),     -- Point for most, LineString for fence_segment
  bearing_deg                 numeric,                       -- for cameras / directional sensors
  attributes                  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Cover photo for the feature (highest-confidence Theodolite shot).
  -- Detail photos live in media_assets.feature_id = this.id.
  primary_photo_url           text,

  -- Confidence + freshness — drives "verify this feature" prompts.
  confidence                  numeric NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  half_life_days              integer NOT NULL DEFAULT 365,
  last_verified_at            timestamptz,
  last_verified_by            uuid REFERENCES auth.users(id),
  last_verified_audit_id      uuid REFERENCES public.site_audits(id),
  created_audit_id            uuid REFERENCES public.site_audits(id),

  source                      text NOT NULL DEFAULT 'audit',
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW(),
  deleted_at                  timestamptz
);

CREATE INDEX IF NOT EXISTS site_features_asset_idx
  ON public.site_features(asset_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS site_features_type_idx
  ON public.site_features(feature_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS site_features_geom_gix
  ON public.site_features USING GIST(geom) WHERE geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_features_last_verified_idx
  ON public.site_features(asset_id, last_verified_at) WHERE deleted_at IS NULL;

CREATE TRIGGER site_features_updated_at
  BEFORE UPDATE ON public.site_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── media_assets — uploaded photos + docs with EXIF ───────────────
CREATE TABLE IF NOT EXISTS public.media_assets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                    uuid NOT NULL REFERENCES public.client_assets(id) ON DELETE CASCADE,
  audit_id                    uuid REFERENCES public.site_audits(id) ON DELETE SET NULL,
  observation_id              uuid REFERENCES public.site_observations(id) ON DELETE SET NULL,
  feature_id                  uuid REFERENCES public.site_features(id) ON DELETE SET NULL,

  -- Storage
  storage_path                text NOT NULL,                        -- bucket-relative path
  kind                        text NOT NULL CHECK (kind IN ('photo','document','video','other')),
  mime_type                   text,
  size_bytes                  bigint,
  filename                    text,

  -- Parsed EXIF / metadata — the moat columns
  captured_at                 timestamptz,
  geom_point                  geometry(Point, 4326),
  altitude_m                  numeric,
  bearing_deg                 numeric,
  bearing_ref                 text CHECK (bearing_ref IS NULL OR bearing_ref IN ('T','M')),  -- True or Magnetic
  pitch_deg                   numeric,
  roll_deg                    numeric,
  gps_accuracy_m              numeric,
  gps_datum                   text,
  software_app                text,                                  -- "Theodolite App - ..." or "iOS"
  focal_length_mm             numeric,
  focal_length_35mm_eq        numeric,

  -- Document-only
  doc_type                    text,                                  -- 'tra_hazop','inspection','drill','insurance','mutual_aid','plot_plan','other'

  raw_exif                    jsonb,

  -- Trust signal — Theodolite + full GPS + low pitch/roll = ~0.98,
  -- stock iPhone GPS = 0.85, manual = 0.6, no GPS = 0.4.
  confidence                  numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),

  uploaded_by                 uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at                 timestamptz NOT NULL DEFAULT NOW(),
  deleted_at                  timestamptz
);

CREATE INDEX IF NOT EXISTS media_assets_asset_idx
  ON public.media_assets(asset_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_assets_audit_idx
  ON public.media_assets(audit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_assets_feature_idx
  ON public.media_assets(feature_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_assets_observation_idx
  ON public.media_assets(observation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_assets_geom_gix
  ON public.media_assets USING GIST(geom_point) WHERE geom_point IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_assets_captured_idx
  ON public.media_assets(asset_id, captured_at DESC) WHERE deleted_at IS NULL;

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.site_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

-- Read all for authenticated (matches Phase 2A posture).
CREATE POLICY "site_features_read_all_auth" ON public.site_features
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "media_assets_read_all_auth" ON public.media_assets
  FOR SELECT TO authenticated USING (true);

-- Authenticated operators can write — the wizard runs in browser, not server.
-- Per-client membership scoping deferred to a follow-up alongside client_assets.
CREATE POLICY "site_features_write_auth" ON public.site_features
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "media_assets_write_auth" ON public.media_assets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role gets unfettered access for server-side use.
CREATE POLICY "site_features_write_service" ON public.site_features
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "media_assets_write_service" ON public.media_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Storage bucket ────────────────────────────────────────────────
-- Private bucket for audit photos / documents. Signed URLs only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-audit-media', 'site-audit-media', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — authenticated users can upload to their own audit folder
-- (path prefix `audit/{audit_id}/...`) and read back any audit media.
CREATE POLICY "site_audit_media_read_auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'site-audit-media');

CREATE POLICY "site_audit_media_write_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-audit-media');

CREATE POLICY "site_audit_media_update_auth" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'site-audit-media')
  WITH CHECK (bucket_id = 'site-audit-media');

CREATE POLICY "site_audit_media_delete_auth" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'site-audit-media');

-- ─── Helper: write feature observation back to client_assets ──────
-- When an audit verifies a feature, refresh last_verified_at +
-- confidence to 1.0 (parallel to refresh_asset_on_audit_complete).
CREATE OR REPLACE FUNCTION public.refresh_feature_on_verify(
  p_feature_id uuid,
  p_audit_id   uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.site_features
  SET last_verified_at        = NOW(),
      last_verified_audit_id  = p_audit_id,
      last_verified_by        = (SELECT primary_operator FROM public.site_audits WHERE id = p_audit_id),
      confidence              = 1.0,
      updated_at              = NOW()
  WHERE id = p_feature_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_feature_on_verify(uuid, uuid)
  TO authenticated, service_role;

COMMIT;
