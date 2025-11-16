-- Add threat scoring fields to entities table
ALTER TABLE entities 
ADD COLUMN IF NOT EXISTS threat_score INTEGER CHECK (threat_score >= 0 AND threat_score <= 100),
ADD COLUMN IF NOT EXISTS threat_indicators TEXT[],
ADD COLUMN IF NOT EXISTS associations TEXT[];

-- Add index for threat score queries
CREATE INDEX IF NOT EXISTS idx_entities_threat_score ON entities(threat_score DESC) WHERE is_active = true;

-- Add comment
COMMENT ON COLUMN entities.threat_score IS 'Threat level score from 0-100 based on analysis';
COMMENT ON COLUMN entities.threat_indicators IS 'Array of identified threat indicators';
COMMENT ON COLUMN entities.associations IS 'Array of associated entities, organizations, or locations';
