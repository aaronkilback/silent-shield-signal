-- Add active monitoring fields to entities table
ALTER TABLE entities 
ADD COLUMN IF NOT EXISTS active_monitoring_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS current_location text,
ADD COLUMN IF NOT EXISTS monitoring_radius_km integer DEFAULT 10;

-- Add comment for clarity
COMMENT ON COLUMN entities.active_monitoring_enabled IS 'When true, system actively searches for threats near this entity';
COMMENT ON COLUMN entities.current_location IS 'Current location for proximity-based threat detection';
COMMENT ON COLUMN entities.monitoring_radius_km IS 'Search radius in kilometers for threat detection';