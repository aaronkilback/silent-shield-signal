-- ═══════════════════════════════════════════════════════════════════════════
--  POI Investigations & Reports
--  Tracks person-of-interest investigation runs and AI-synthesized reports.
-- ═══════════════════════════════════════════════════════════════════════════

-- poi_investigations: one row per investigation run per entity
CREATE TABLE IF NOT EXISTS poi_investigations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        UUID        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'completed', 'failed')),
  queries_run      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sources_searched INTEGER     NOT NULL DEFAULT 0,
  results_found    INTEGER     NOT NULL DEFAULT 0,
  hibp_checked     BOOLEAN     NOT NULL DEFAULT FALSE,
  hibp_breaches    JSONB       DEFAULT NULL,
  report_id        UUID        DEFAULT NULL,   -- FK added below after poi_reports exists
  error_message    TEXT        DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- poi_reports: AI-synthesized intelligence reports
CREATE TABLE IF NOT EXISTS poi_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        UUID        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  investigation_id UUID        REFERENCES poi_investigations(id) ON DELETE SET NULL,
  report_markdown  TEXT        NOT NULL,
  confidence_score INTEGER     CHECK (confidence_score BETWEEN 0 AND 100),
  threat_level     TEXT        CHECK (threat_level IN ('none', 'low', 'medium', 'high', 'critical')),
  subject_profile  JSONB       DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Circular FK: poi_investigations.report_id → poi_reports.id
ALTER TABLE poi_investigations
  ADD CONSTRAINT fk_poi_investigations_report_id
  FOREIGN KEY (report_id) REFERENCES poi_reports(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_poi_investigations_entity_id ON poi_investigations(entity_id);
CREATE INDEX IF NOT EXISTS idx_poi_investigations_status    ON poi_investigations(status);
CREATE INDEX IF NOT EXISTS idx_poi_investigations_created   ON poi_investigations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poi_reports_entity_id        ON poi_reports(entity_id);
CREATE INDEX IF NOT EXISTS idx_poi_reports_investigation_id ON poi_reports(investigation_id);
CREATE INDEX IF NOT EXISTS idx_poi_reports_created          ON poi_reports(created_at DESC);

-- Auto-update updated_at on poi_investigations
CREATE OR REPLACE FUNCTION update_poi_investigations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poi_investigations_updated_at ON poi_investigations;
CREATE TRIGGER trg_poi_investigations_updated_at
  BEFORE UPDATE ON poi_investigations
  FOR EACH ROW EXECUTE FUNCTION update_poi_investigations_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE poi_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE poi_reports        ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) has full access
CREATE POLICY "service_role_manage_poi_investigations" ON poi_investigations
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_manage_poi_reports" ON poi_reports
  USING (auth.role() = 'service_role');

-- Any authenticated user can read investigations and reports
CREATE POLICY "auth_read_poi_investigations" ON poi_investigations
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_read_poi_reports" ON poi_reports
  FOR SELECT USING (auth.uid() IS NOT NULL);
