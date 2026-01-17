-- Add intelligence-style ratings to signals table
ALTER TABLE public.signals
ADD COLUMN IF NOT EXISTS source_reliability text DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS information_accuracy text DEFAULT 'cannot_be_judged';

-- Add intelligence-style ratings to incidents table  
ALTER TABLE public.incidents
ADD COLUMN IF NOT EXISTS source_reliability text DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS information_accuracy text DEFAULT 'cannot_be_judged';

-- Add constraints (using separate ALTER statements to avoid issues)
DO $$ 
BEGIN
  -- Add check constraints if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'signals_source_reliability_check'
  ) THEN
    ALTER TABLE public.signals 
    ADD CONSTRAINT signals_source_reliability_check 
    CHECK (source_reliability IN ('unknown', 'usually_reliable', 'reliable'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'signals_information_accuracy_check'
  ) THEN
    ALTER TABLE public.signals 
    ADD CONSTRAINT signals_information_accuracy_check 
    CHECK (information_accuracy IN ('cannot_be_judged', 'possibly_true', 'confirmed'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'incidents_source_reliability_check'
  ) THEN
    ALTER TABLE public.incidents 
    ADD CONSTRAINT incidents_source_reliability_check 
    CHECK (source_reliability IN ('unknown', 'usually_reliable', 'reliable'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'incidents_information_accuracy_check'
  ) THEN
    ALTER TABLE public.incidents 
    ADD CONSTRAINT incidents_information_accuracy_check 
    CHECK (information_accuracy IN ('cannot_be_judged', 'possibly_true', 'confirmed'));
  END IF;
END $$;