-- First, update existing scores to new scale (divide by 10 and round)
UPDATE entities 
SET threat_score = LEAST(10, GREATEST(0, ROUND((threat_score / 10.0)::numeric, 1))) 
WHERE threat_score IS NOT NULL AND threat_score > 10;

-- Drop old constraint
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_threat_score_check;

-- Add new constraint for 0-10 scale
ALTER TABLE entities ADD CONSTRAINT entities_threat_score_check CHECK (threat_score >= 0 AND threat_score <= 10);

-- Update comment
COMMENT ON COLUMN entities.threat_score IS 'Threat level score from 0-10 based on recency, confidence, and relevancy';
