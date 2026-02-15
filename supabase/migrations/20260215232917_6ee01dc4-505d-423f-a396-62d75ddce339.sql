
-- Add 'mitigated' to incident_status enum if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'mitigated' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'incident_status')
  ) THEN
    ALTER TYPE incident_status ADD VALUE 'mitigated';
  END IF;
END $$;

-- Add closed_at column to incidents table if not present
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

-- Backfill closed_at for already-closed incidents
UPDATE public.incidents
SET closed_at = updated_at
WHERE status = 'closed' AND closed_at IS NULL;
