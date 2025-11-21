-- Intelligence System Rebuild: Core Schema

-- 1. SOURCES (enhanced)
-- Drop and recreate with better structure
DROP TABLE IF EXISTS sources CASCADE;
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('url_feed', 'uploaded_document', 'manual_text', 'api_feed')),
  config JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'failed')),
  last_ingested_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. INGESTED DOCUMENTS (replaces archival_documents with better structure)
CREATE TABLE ingested_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT,
  raw_text TEXT,
  content_hash TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  chunk_index INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 1,
  parent_document_id UUID REFERENCES ingested_documents(id) ON DELETE CASCADE,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ingested_documents_source ON ingested_documents(source_id);
CREATE INDEX idx_ingested_documents_parent ON ingested_documents(parent_document_id);
CREATE INDEX idx_ingested_documents_status ON ingested_documents(processing_status);

-- 3. ENTITIES (enhanced with confidence and status)
ALTER TABLE entities DROP COLUMN IF EXISTS confidence_score;
ALTER TABLE entities DROP COLUMN IF EXISTS entity_status;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS confidence_score NUMERIC DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS entity_status TEXT DEFAULT 'suggested' CHECK (entity_status IN ('suggested', 'confirmed', 'rejected'));

-- 4. ENTITY MENTIONS (link entities to documents)
DROP TABLE IF EXISTS document_entity_mentions CASCADE;
CREATE TABLE document_entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES ingested_documents(id) ON DELETE CASCADE,
  mention_text TEXT,
  position_start INTEGER,
  position_end INTEGER,
  confidence NUMERIC DEFAULT 0.7,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, document_id, position_start)
);

CREATE INDEX idx_doc_entity_mentions_entity ON document_entity_mentions(entity_id);
CREATE INDEX idx_doc_entity_mentions_document ON document_entity_mentions(document_id);

-- 5. SIGNALS (enhanced with relevance and learning fields)
ALTER TABLE signals DROP COLUMN IF EXISTS relevance_score;
ALTER TABLE signals DROP COLUMN IF EXISTS severity_score;
ALTER TABLE signals DROP COLUMN IF EXISTS signal_type;
ALTER TABLE signals DROP COLUMN IF EXISTS title;
ALTER TABLE signals DROP COLUMN IF EXISTS description;

ALTER TABLE signals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS signal_type TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS severity_score INTEGER DEFAULT 50 CHECK (severity_score >= 0 AND severity_score <= 100);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS relevance_score NUMERIC DEFAULT 0.5 CHECK (relevance_score >= 0 AND relevance_score <= 1);

-- Link signals to documents
DROP TABLE IF EXISTS signal_documents CASCADE;
CREATE TABLE signal_documents (
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES ingested_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (signal_id, document_id)
);

-- 6. INCIDENTS (enhanced with proper severity levels)
ALTER TABLE incidents DROP COLUMN IF EXISTS severity_level;
ALTER TABLE incidents DROP COLUMN IF EXISTS incident_type;
ALTER TABLE incidents DROP COLUMN IF EXISTS title;
ALTER TABLE incidents DROP COLUMN IF EXISTS summary;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_type TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_level TEXT DEFAULT 'P3' CHECK (severity_level IN ('P1', 'P2', 'P3', 'P4'));

-- Link incidents to multiple signals (many-to-many)
DROP TABLE IF EXISTS incident_signals CASCADE;
CREATE TABLE incident_signals (
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (incident_id, signal_id)
);

-- Link incidents to entities (many-to-many)
DROP TABLE IF EXISTS incident_entities CASCADE;
CREATE TABLE incident_entities (
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (incident_id, entity_id)
);

-- 7. FEEDBACK EVENTS (learning system)
CREATE TABLE feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type TEXT NOT NULL CHECK (object_type IN ('signal', 'incident', 'entity')),
  object_id UUID NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('relevant', 'irrelevant', 'too_minor', 'duplicate', 'confirmed', 'rejected')),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_feedback_events_object ON feedback_events(object_type, object_id);
CREATE INDEX idx_feedback_events_user ON feedback_events(user_id);
CREATE INDEX idx_feedback_events_created ON feedback_events(created_at);

-- 8. LEARNING PROFILES (track patterns for relevance scoring)
CREATE TABLE learning_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_type TEXT NOT NULL CHECK (profile_type IN ('approved_signal_patterns', 'rejected_signal_patterns', 'entity_patterns')),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  weight NUMERIC DEFAULT 1.0,
  sample_count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. SYSTEM CONFIG (for thresholds and rules)
CREATE TABLE intelligence_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

-- Insert default config
INSERT INTO intelligence_config (key, value, description) VALUES
  ('severity_thresholds', '{"P1": 80, "P2": 50, "P3": 20, "P4": 0}'::jsonb, 'Severity score thresholds for incident escalation'),
  ('correlation_window_days', '7'::jsonb, 'Time window for signal correlation in days'),
  ('auto_escalation_enabled', 'true'::jsonb, 'Whether to auto-create incidents from high-severity signals'),
  ('min_relevance_score', '0.3'::jsonb, 'Minimum relevance score to create a signal')
ON CONFLICT (key) DO NOTHING;

-- RLS Policies
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_config ENABLE ROW LEVEL SECURITY;

-- Analysts and admins can access everything
CREATE POLICY "Analysts and admins full access to sources" ON sources FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to ingested_documents" ON ingested_documents FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to doc_entity_mentions" ON document_entity_mentions FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to signal_documents" ON signal_documents FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to incident_signals" ON incident_signals FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to incident_entities" ON incident_entities FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to feedback_events" ON feedback_events FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to learning_profiles" ON learning_profiles FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins full access to intelligence_config" ON intelligence_config FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Service role policies
CREATE POLICY "Service role full access to sources" ON sources FOR ALL USING (true);
CREATE POLICY "Service role full access to ingested_documents" ON ingested_documents FOR ALL USING (true);
CREATE POLICY "Service role full access to doc_entity_mentions" ON document_entity_mentions FOR ALL USING (true);
CREATE POLICY "Service role full access to signal_documents" ON signal_documents FOR ALL USING (true);
CREATE POLICY "Service role full access to incident_signals" ON incident_signals FOR ALL USING (true);
CREATE POLICY "Service role full access to incident_entities" ON incident_entities FOR ALL USING (true);
CREATE POLICY "Service role full access to feedback_events" ON feedback_events FOR ALL USING (true);
CREATE POLICY "Service role full access to learning_profiles" ON learning_profiles FOR ALL USING (true);
CREATE POLICY "Service role full access to intelligence_config" ON intelligence_config FOR ALL USING (true);