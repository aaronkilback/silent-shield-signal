-- Add 'investigating' to incident_status enum
-- Fixes: invalid input value for enum incident_status: "investigating"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'investigating'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'incident_status')
  ) THEN
    ALTER TYPE incident_status ADD VALUE 'investigating';
  END IF;
END $$;
