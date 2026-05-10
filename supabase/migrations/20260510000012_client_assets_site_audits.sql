-- ═══════════════════════════════════════════════════════════════════════
-- CLIENT ASSETS + SITE AUDITS + SITE OBSERVATIONS — substrate Phase 2A
-- ═══════════════════════════════════════════════════════════════════════
--
-- Per-client physical footprint + structured audit-capture infrastructure.
-- This is the "second half" of the May 8 architecture: the canvas
-- (world_geographies) is what's true regardless of client; this layer
-- holds what's true for a SPECIFIC client. It's where the moat lives —
-- every site walk the operator does writes here.
--
-- Three tables, each with a clear single purpose:
--
-- 1. client_assets — one row per physical site / asset that belongs to
--    a client. Gas plant, well pad, office building, residence, event
--    venue, infrastructure node. Has geometry (point or polygon).
--    Has criticality + operational status. Has a soft-delete and a
--    last_verified_at so the substrate ages without re-verification.
--
-- 2. site_audits — one row per audit walk. Groups all observations
--    captured during a single visit to one asset. Has wizard_state
--    (jsonb) so operators can pause and resume mid-walk. Tracks the
--    primary operator + collaborative co-operators per audit.
--
-- 3. site_observations — one row per observation captured during an
--    audit. Stage + field_key + value + freeform notes + photo URLs +
--    optional location-on-site. The volume table — could be 30-100
--    rows per audit.
--
-- Design commitments (committed by May 10 design pass):
--
-- A) ONE primary geometry column on client_assets (`geom`) handles
--    both points (most assets) and polygons (fenced perimeters
--    captured during an audit). The audit wizard upgrades a point
--    asset to polygon when the operator walks the perimeter.
--
-- B) ALL audit observations write back to client_assets.last_verified_at
--    on completion — a successfully completed audit resets the asset's
--    confidence to 1.0 (the May 8 confidence-decay loop's signal).
--
-- C) Soft-delete only on client_assets — site_observations and
--    site_audits hard-delete because they're write-once records of
--    work performed (cascade from asset).
--
-- D) RLS by client membership — Phase 2A leaves RLS scaffolding in
--    place but defers per-client read-access to a follow-up that ties
--    it to the existing client/operator role model. For now,
--    authenticated users can read all rows (so the wizard works) and
--    service_role can write.

BEGIN;

-- ─── client_assets — per-client physical footprint ─────────────────
CREATE TABLE IF NOT EXISTS public.client_assets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Identity
  name                   text NOT NULL,
  asset_class            text NOT NULL CHECK (asset_class IN (
    'oil_gas_plant',
    'well_pad',
    'pipeline_section',
    'office',
    'event_venue',
    'residence',
    'field_office',
    'infrastructure_node',
    'other'
  )),
  asset_subtype          text,
  external_ref           text,

  -- Geometry — single column, supports both Point and Polygon
  geom                   geometry(Geometry, 4326),
  -- Optional separate perimeter (when both centroid and walked
  -- perimeter are known — typical after a full audit)
  perimeter_geom         geometry(Polygon, 4326),

  -- Operational state
  operational_status     text NOT NULL DEFAULT 'active' CHECK (operational_status IN (
    'active',
    'turnaround',
    'mothballed',
    'decommissioned',
    'proposed'
  )),
  criticality_tier       text CHECK (criticality_tier IS NULL OR criticality_tier IN (
    'tier_1',  -- highest — loss is catastrophic / critical to operations
    'tier_2',
    'tier_3',
    'tier_4'   -- lowest — incidental
  )),

  -- Site-type-specific arbitrary fields (operator, capacity, vendors, etc.)
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance + verification
  source                 text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('audit', 'filing', 'osint', 'manual', 'drift_accepted')),
  last_verified_at       timestamptz,
  last_verified_by       uuid,
  -- Confidence decays without re-verification. Default starts at 0.5
  -- (substrate-derived) and rises to 1.0 on first audit verify.
  confidence             numeric NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0 AND confidence <= 1),
  -- Per-asset half-life override; when null, system default applies.
  confidence_half_life_days integer,

  -- Soft-delete
  deleted_at             timestamptz,

  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT client_assets_unique_name UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS client_assets_client_idx
  ON public.client_assets(client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS client_assets_geom_gix
  ON public.client_assets USING GIST(geom) WHERE geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_assets_perimeter_gix
  ON public.client_assets USING GIST(perimeter_geom) WHERE perimeter_geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_assets_class_idx
  ON public.client_assets(asset_class) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS client_assets_status_idx
  ON public.client_assets(operational_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS client_assets_confidence_idx
  ON public.client_assets(confidence) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS client_assets_external_ref_idx
  ON public.client_assets(client_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_assets_name_trgm_idx
  ON public.client_assets USING GIN(name gin_trgm_ops);

COMMENT ON TABLE public.client_assets IS
  'Per-client physical footprint. One row per site / asset (gas plant, well pad, office, residence, event venue, etc.). Refreshed by audits + signal-derived drift. Confidence decays without re-verification.';

-- ─── site_audits — one row per audit walk ──────────────────────────
CREATE TABLE IF NOT EXISTS public.site_audits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id               uuid NOT NULL REFERENCES public.client_assets(id) ON DELETE CASCADE,
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  status                 text NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress',
    'completed',
    'abandoned'
  )),
  started_at             timestamptz NOT NULL DEFAULT NOW(),
  completed_at           timestamptz,

  primary_operator       uuid NOT NULL,
  co_operators           uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- Wizard-state for resume: { current_stage, completed_stages[], applied_prompts[] }
  wizard_state           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Roll-up summary (populated on complete)
  summary_text           text,
  observations_count     integer NOT NULL DEFAULT 0,
  vulnerabilities_added  integer NOT NULL DEFAULT 0,
  controls_confirmed     integer NOT NULL DEFAULT 0,

  -- Generated artifact (PDF report uploaded to storage)
  report_url             text,

  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_audits_asset_idx ON public.site_audits(asset_id);
CREATE INDEX IF NOT EXISTS site_audits_client_idx ON public.site_audits(client_id);
CREATE INDEX IF NOT EXISTS site_audits_status_idx ON public.site_audits(status);
CREATE INDEX IF NOT EXISTS site_audits_operator_idx ON public.site_audits(primary_operator);
-- Composite for "find my in-progress audits"
CREATE INDEX IF NOT EXISTS site_audits_resume_idx
  ON public.site_audits(primary_operator, status, started_at DESC)
  WHERE status = 'in_progress';

COMMENT ON TABLE public.site_audits IS
  'One row per audit walk on a specific client_asset. Groups all observations from a single visit. wizard_state holds the resume cursor so a partial audit can be picked up where it was left off — usually next time the operator opens the wizard for this asset.';

-- ─── site_observations — one row per captured observation ──────────
CREATE TABLE IF NOT EXISTS public.site_observations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id               uuid NOT NULL REFERENCES public.site_audits(id) ON DELETE CASCADE,
  asset_id               uuid NOT NULL REFERENCES public.client_assets(id) ON DELETE CASCADE,

  -- Stage in the audit wizard this observation came from
  stage                  text NOT NULL CHECK (stage IN (
    'identity',
    'adjacency',
    'perimeter',
    'access_personnel',
    'ot_ics',
    'comms',
    'external_intel',
    'docs_compliance',
    'action_synthesis'
  )),
  -- Specific field within the stage (e.g. 'fence_condition',
  -- 'cell_carrier', 'tra_last_revised', 'rcmp_response_time_minutes')
  field_key              text NOT NULL,

  -- Value and notes are both optional but at least one must be set.
  value                  jsonb,
  freeform_notes         text,

  -- Spatial + visual evidence
  location               geometry(Point, 4326),
  photo_urls             text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Confidence in the observation itself (operator-set or 1.0 default)
  confidence             numeric NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0 AND confidence <= 1),

  -- Linked outputs (downstream risk-register rows this observation
  -- affects; populated in the synthesis stage)
  linked_risk_ids        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- Author + timing
  observer_id            uuid NOT NULL,
  observed_at            timestamptz NOT NULL DEFAULT NOW(),

  created_at             timestamptz NOT NULL DEFAULT NOW(),

  -- An observation must have either structured value or freeform text
  CONSTRAINT site_observations_value_or_notes
    CHECK (value IS NOT NULL OR (freeform_notes IS NOT NULL AND length(trim(freeform_notes)) > 0))
);

CREATE INDEX IF NOT EXISTS site_observations_audit_idx ON public.site_observations(audit_id);
CREATE INDEX IF NOT EXISTS site_observations_asset_idx ON public.site_observations(asset_id);
CREATE INDEX IF NOT EXISTS site_observations_stage_field_idx
  ON public.site_observations(asset_id, stage, field_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS site_observations_location_gix
  ON public.site_observations USING GIST(location) WHERE location IS NOT NULL;

COMMENT ON TABLE public.site_observations IS
  'Volume table: one row per observation captured during a site audit. 30-100 rows per audit is normal. Linked back to client_assets so historical state is queryable per-asset over time. The trail that lets AEGIS say "perimeter fence at D-035-D was rated fair on 2025-04-12 by Aaron Kilback".';

-- ─── Auto-update updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_audit_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_assets_touch ON public.client_assets;
CREATE TRIGGER client_assets_touch
  BEFORE UPDATE ON public.client_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_audit_updated_at();

DROP TRIGGER IF EXISTS site_audits_touch ON public.site_audits;
CREATE TRIGGER site_audits_touch
  BEFORE UPDATE ON public.site_audits
  FOR EACH ROW EXECUTE FUNCTION public.touch_audit_updated_at();

-- ─── On audit completion, refresh asset's verification timestamp ──
-- Trigger fires when site_audits.status flips to 'completed'.
-- Bumps the parent asset's last_verified_at + confidence.
CREATE OR REPLACE FUNCTION public.refresh_asset_on_audit_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    UPDATE public.client_assets
    SET last_verified_at = NEW.completed_at,
        last_verified_by = NEW.primary_operator,
        confidence = 1.0,
        updated_at = NOW()
    WHERE id = NEW.asset_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_audits_refresh_asset ON public.site_audits;
CREATE TRIGGER site_audits_refresh_asset
  AFTER UPDATE ON public.site_audits
  FOR EACH ROW EXECUTE FUNCTION public.refresh_asset_on_audit_complete();

-- ─── RLS scaffolding ───────────────────────────────────────────────
-- Phase 2A: authenticated users can read everything (so the wizard
-- works for any logged-in operator), service_role writes everything.
-- Per-client read isolation moves to a follow-up that ties into the
-- existing operator-membership tables — designed there, not here.

ALTER TABLE public.client_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_assets_read_all_auth" ON public.client_assets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "client_assets_write_service" ON public.client_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "site_audits_read_all_auth" ON public.site_audits
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "site_audits_write_service" ON public.site_audits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Authenticated operators need to write their own audits (the wizard
-- writes from the client, not from a server function). Restrict to
-- audits where they're the primary operator.
CREATE POLICY "site_audits_write_own" ON public.site_audits
  FOR ALL TO authenticated
  USING (auth.uid() = primary_operator)
  WITH CHECK (auth.uid() = primary_operator);

CREATE POLICY "site_observations_read_all_auth" ON public.site_observations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "site_observations_write_service" ON public.site_observations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Operators can write observations only into their own in-progress audits.
CREATE POLICY "site_observations_write_own_audit" ON public.site_observations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.site_audits a
      WHERE a.id = audit_id
        AND a.primary_operator = auth.uid()
        AND a.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.site_audits a
      WHERE a.id = audit_id
        AND a.primary_operator = auth.uid()
        AND a.status = 'in_progress'
    )
  );

-- ─── Verify ────────────────────────────────────────────────────────
SELECT
  'client_assets_table' AS metric,
  COUNT(*)::text AS val
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'client_assets'
UNION ALL
SELECT 'site_audits_table', COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'site_audits'
UNION ALL
SELECT 'site_observations_table', COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'site_observations'
UNION ALL
SELECT 'client_assets_indexes', COUNT(*)::text
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'client_assets';

COMMIT;
