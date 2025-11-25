-- Add columns to signals table for rule-based categorization
ALTER TABLE signals 
ADD COLUMN IF NOT EXISTS applied_rules jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS rule_tags text[] DEFAULT ARRAY[]::text[],
ADD COLUMN IF NOT EXISTS rule_category text,
ADD COLUMN IF NOT EXISTS rule_priority text,
ADD COLUMN IF NOT EXISTS routed_to_team text;

-- Create index for rule-based queries
CREATE INDEX IF NOT EXISTS idx_signals_rule_category ON signals(rule_category);
CREATE INDEX IF NOT EXISTS idx_signals_rule_priority ON signals(rule_priority);
CREATE INDEX IF NOT EXISTS idx_signals_routed_to_team ON signals(routed_to_team);

COMMENT ON COLUMN signals.applied_rules IS 'JSON array of rule names that matched this signal';
COMMENT ON COLUMN signals.rule_tags IS 'Tags added by automated rules';
COMMENT ON COLUMN signals.rule_category IS 'Category assigned by automated rules';
COMMENT ON COLUMN signals.rule_priority IS 'Priority assigned by automated rules';
COMMENT ON COLUMN signals.routed_to_team IS 'Team that should receive this signal (from rules)';