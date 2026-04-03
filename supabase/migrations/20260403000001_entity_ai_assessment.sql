-- Add AI assessment columns to entity_suggestions
ALTER TABLE entity_suggestions
  ADD COLUMN IF NOT EXISTS ai_assessment jsonb,
  ADD COLUMN IF NOT EXISTS ai_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_risk_level text,
  ADD COLUMN IF NOT EXISTS ai_threat_score int;

-- Add AI assessment columns to entities
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS ai_assessment jsonb,
  ADD COLUMN IF NOT EXISTS ai_assessed_at timestamptz;
