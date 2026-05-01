-- Per-client ArcGIS integration.
--
-- Petronas Canada has an ArcGIS account holding pipeline routes, facilities,
-- right-of-way, easements, vegetation/wildfire-risk overlays, and
-- operational status data. The Fortress agents (AI-DECISION-ENGINE,
-- TIER2-REVIEW, MERIDIAN, ARGUS, etc) currently reason about signals with
-- no awareness of where Petronas's actual assets are. Connecting ArcGIS
-- gives them spatial ground truth — "this hotspot is 1.2km from the CGL
-- centerline" or "this protest is inside the Operational Lands easement"
-- become facts the agents can verify, not inferences.
--
-- Architecture:
--   - One row per client per ArcGIS instance (most clients have one).
--   - OAuth client_credentials flow (recommended) OR API-key fallback.
--   - Token cached in this table with expiry; refreshed automatically.
--   - layer_aliases is a friendly_name -> layer_url map an admin configures
--     once. Agents reference layers by friendly name ("pipeline_centerline",
--     "compressor_stations", "operational_easement") and the client picks
--     the right URL behind the scenes.
--
-- Setup: admin UI at /clients/:id/arcgis lets the customer's ArcGIS team
-- create an Application Item in their portal, give it a client_id and
-- client_secret with read access to whichever feature services they want
-- exposed, and paste those into the page. The arcgis-test-connection
-- function then validates and discovers layers.

CREATE TABLE IF NOT EXISTS public.client_arcgis_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Friendly label for this connection (Petronas may have multiple ArcGIS
  -- workspaces — this lets us tell them apart in UIs).
  label           text NOT NULL DEFAULT 'Primary ArcGIS',
  -- Base URL of the ArcGIS Online or ArcGIS Enterprise portal. e.g.
  -- "https://www.arcgis.com" (ArcGIS Online) or
  -- "https://gis.petronas.com/portal" (Enterprise). Trailing slash stripped.
  portal_url      text NOT NULL,
  -- OAuth 2.0 client_credentials. Both stored encrypted in Supabase secrets;
  -- this table only holds the SECRET NAME the runtime should look up.
  oauth_client_id     text,
  oauth_client_secret_ref text,    -- name of the Supabase secret (Deno.env.get(...))
  -- Optional API-key fallback if OAuth is not enabled. Less secure (no
  -- expiry, no revocation per session); only use when OAuth is unavailable.
  api_key_secret_ref  text,
  -- Cached OAuth token to avoid re-auth on every query. Refreshed in code.
  access_token        text,
  token_expires_at    timestamptz,
  -- Layer alias map: friendly_name -> { url, description, geometry_type }
  -- Example:
  --   {
  --     "pipeline_centerline": {
  --       "url": "https://services.arcgis.com/.../FeatureServer/0",
  --       "description": "Coastal GasLink centerline",
  --       "geometry_type": "esriGeometryPolyline"
  --     },
  --     "compressor_stations": {
  --       "url": "https://services.arcgis.com/.../FeatureServer/2",
  --       "description": "Active compressor station locations",
  --       "geometry_type": "esriGeometryPoint"
  --     }
  --   }
  layer_aliases   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Discovered layer metadata from the test-connection probe (informational)
  discovered_layers jsonb,
  -- Status
  is_active       boolean NOT NULL DEFAULT true,
  last_tested_at  timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  -- One active primary per client
  CONSTRAINT one_active_per_client UNIQUE (client_id, label)
);

CREATE INDEX IF NOT EXISTS idx_arcgis_connections_client_active
  ON public.client_arcgis_connections (client_id) WHERE is_active = true;

-- RLS: super_admin sees all; org admins see their tenant's client connections.
-- Service role has full access for the agent tools to query.
ALTER TABLE public.client_arcgis_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arcgis_connections_super_admin_all" ON public.client_arcgis_connections;
CREATE POLICY "arcgis_connections_super_admin_all" ON public.client_arcgis_connections
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "arcgis_connections_service_role_all" ON public.client_arcgis_connections;
CREATE POLICY "arcgis_connections_service_role_all" ON public.client_arcgis_connections
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.client_arcgis_connections IS
  'Per-client ArcGIS integration config. Agents query through _shared/arcgis.ts which loads the active connection for the signal''s client_id, refreshes OAuth token if needed, runs spatial queries against the configured layer aliases. Petronas Canada''s pipeline / facility / easement layers connected here become evidence agents can verify.';

COMMENT ON COLUMN public.client_arcgis_connections.layer_aliases IS
  'friendly_name -> {url, description, geometry_type} map. Agents request layers by friendly name (e.g. "pipeline_centerline"); client config maps to actual ArcGIS layer URL. Lets us swap layers without changing agent prompts.';
