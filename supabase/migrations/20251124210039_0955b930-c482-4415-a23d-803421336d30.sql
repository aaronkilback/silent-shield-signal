
-- Ensure vehicle type exists in entity_type enum
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'vehicle' 
    AND enumtypid = 'entity_type'::regtype
  ) THEN
    ALTER TYPE entity_type ADD VALUE 'vehicle';
  END IF;
END $$;

-- Add comment to document vehicle attributes structure
COMMENT ON COLUMN entities.attributes IS 'JSON field storing type-specific attributes. For vehicles: {vehicle_info: {year, make, model, license_plate}, generated_image_url, image_feedback}';
