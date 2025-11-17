-- Add monitor_type field to sources table to map sources to specific monitors
ALTER TABLE sources ADD COLUMN monitor_type text;

-- Add a comment to clarify usage
COMMENT ON COLUMN sources.monitor_type IS 'The type of monitor that should use this source (e.g., canadian_sources, drivebc, news, social_media, etc.)';

-- Create index for faster lookups
CREATE INDEX idx_sources_monitor_type ON sources(monitor_type) WHERE is_active = true;