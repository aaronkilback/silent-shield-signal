-- ============================================================
-- Staging environment one-time setup
-- ============================================================
-- Run THIS in the new staging Supabase project (NOT production).
-- Apply AFTER:
--   1. Staging project created (Pro tier recommended)
--   2. All production migrations applied via `supabase db push`
--   3. Vault secrets seeded (OPENAI_API_KEY, GEMINI_API_KEY, etc.)
--
-- What it does:
--   a) Disables EVERY cron schedule. Staging is on-demand, not continuous.
--   b) Inserts 2 test clients (sandbox) for verification.
--   c) Creates a marker row so we can tell at a glance this is staging.
-- ============================================================

-- (a) Disable every cron schedule. Operator manually re-enables specific
--     jobs only when a test needs cron-driven flow.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE active = true LOOP
    PERFORM cron.unschedule(j.jobname);
    RAISE NOTICE 'Unscheduled: %', j.jobname;
  END LOOP;
END $$;

-- Verify: should return 0
SELECT COUNT(*) AS still_active_crons FROM cron.job WHERE active = true;

-- (b) Seed minimal test clients
INSERT INTO clients (name, organization, industry, locations, high_value_assets, monitoring_keywords, status)
VALUES
  ('_staging_petronas', 'Petronas Staging Sandbox', 'energy',
   ARRAY['Kitimat','Fort St. John','BC'],
   ARRAY['LNG Canada','Coastal GasLink'],
   ARRAY['LNG Canada','Coastal GasLink','Wet''suwet''en'],
   'active'),
  ('_staging_bcch', 'BC Children''s Hospital Staging', 'healthcare',
   ARRAY['Vancouver','BC'],
   ARRAY['BCCH gender clinic'],
   ARRAY['gender clinic','BCCH','transactivism'],
   'active')
ON CONFLICT (name) DO NOTHING;

-- (c) Staging marker — let any human or script see at a glance which DB they're in
CREATE TABLE IF NOT EXISTS environment_marker (
  id int PRIMARY KEY DEFAULT 1,
  environment text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT one_row CHECK (id = 1)
);
INSERT INTO environment_marker (id, environment)
VALUES (1, 'STAGING')
ON CONFLICT (id) DO UPDATE SET environment = 'STAGING';

-- Final verification — should show: 0 active crons, 2 staging clients, STAGING marker
SELECT
  (SELECT COUNT(*) FROM cron.job WHERE active = true) AS active_crons,
  (SELECT COUNT(*) FROM clients WHERE name LIKE '\_staging\_%' ESCAPE '\') AS staging_clients,
  (SELECT environment FROM environment_marker WHERE id = 1) AS env_marker;
