
-- Add unique intake email tag for each investigation (auto-generated)
ALTER TABLE public.investigations 
ADD COLUMN IF NOT EXISTS intake_email_tag TEXT UNIQUE;

-- Generate tags for existing investigations
UPDATE public.investigations 
SET intake_email_tag = LOWER(REPLACE(file_number, ' ', '-')) || '-' || LEFT(id::text, 6)
WHERE intake_email_tag IS NULL;

-- Create function to auto-generate intake_email_tag on new investigations
CREATE OR REPLACE FUNCTION public.auto_generate_intake_email_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.intake_email_tag IS NULL THEN
    NEW.intake_email_tag := LOWER(REPLACE(COALESCE(NEW.file_number, 'inv'), ' ', '-')) || '-' || LEFT(NEW.id::text, 6);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS set_intake_email_tag ON public.investigations;
CREATE TRIGGER set_intake_email_tag
  BEFORE INSERT ON public.investigations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_intake_email_tag();
