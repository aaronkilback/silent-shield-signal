-- Path 3: link-only mode for ArcGIS integration.
--
-- Some clients have an ArcGIS Experience (a web-published interactive map)
-- but no admin access to register an OAuth app or API key. In that case we
-- can't query their data programmatically — but we CAN show analysts a
-- one-click link to the Experience from any signal scoped to that client.
--
-- This migration adds two display-only fields:
--   experience_url   — the published Experience URL
--                       (e.g. https://experience.arcgis.com/experience/<id>)
--   experience_label — friendly label shown on the link
--                       (e.g. "Petronas operational map")
--
-- Also relaxes portal_url to be NULLABLE so a row can exist with ONLY the
-- experience link configured. If/when API credentials are added later,
-- portal_url + oauth/api fields populate alongside the existing experience_url
-- and the agent tools start querying live data — no schema migration needed.

ALTER TABLE public.client_arcgis_connections
  ADD COLUMN IF NOT EXISTS experience_url   text,
  ADD COLUMN IF NOT EXISTS experience_label text;

ALTER TABLE public.client_arcgis_connections
  ALTER COLUMN portal_url DROP NOT NULL;

COMMENT ON COLUMN public.client_arcgis_connections.experience_url IS
  'Optional public ArcGIS Experience URL for the client. Rendered as a "View on operational map" link from every signal/incident scoped to this client. Independent of the API credentials — present even when no programmatic access is available.';
COMMENT ON COLUMN public.client_arcgis_connections.experience_label IS
  'Display label for the experience_url link. Defaults to "View operational map" if blank.';
