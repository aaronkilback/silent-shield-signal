-- Add monitoring configuration fields to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS monitoring_keywords TEXT[] DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS competitor_names TEXT[] DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS supply_chain_entities TEXT[] DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS monitoring_config JSONB DEFAULT '{
  "min_relevance_score": 50,
  "auto_create_incidents": true,
  "priority_keywords": [],
  "exclude_keywords": []
}'::jsonb;

COMMENT ON COLUMN clients.monitoring_keywords IS 'Custom keywords specific to this client for OSINT monitoring (e.g., LNG, upstream, project names)';
COMMENT ON COLUMN clients.competitor_names IS 'Competitor organization names to monitor';
COMMENT ON COLUMN clients.supply_chain_entities IS 'Vendors, contractors, and supply chain partners to monitor';
COMMENT ON COLUMN clients.monitoring_config IS 'Advanced monitoring configuration including relevance thresholds and filters';