
-- 1. Auto-generate signal title from normalized_text when title is null
CREATE OR REPLACE FUNCTION public.auto_generate_signal_title()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If title is null but normalized_text exists, generate title
  IF NEW.title IS NULL AND NEW.normalized_text IS NOT NULL AND LENGTH(NEW.normalized_text) > 0 THEN
    -- Take first sentence or first 100 chars
    NEW.title := LEFT(
      CASE 
        WHEN POSITION('.' IN NEW.normalized_text) > 0 AND POSITION('.' IN NEW.normalized_text) <= 100 
        THEN LEFT(NEW.normalized_text, POSITION('.' IN NEW.normalized_text))
        WHEN LENGTH(NEW.normalized_text) > 100 
        THEN LEFT(NEW.normalized_text, 97) || '...'
        ELSE NEW.normalized_text
      END,
    150);
  END IF;
  
  -- Fallback: if still null, use timestamp
  IF NEW.title IS NULL OR LENGTH(TRIM(NEW.title)) = 0 THEN
    NEW.title := 'Signal - ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_signal_title
  BEFORE INSERT ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_signal_title();

-- 2. Auto-cleanup feedback_events when a signal is deleted
CREATE OR REPLACE FUNCTION public.cascade_delete_signal_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.feedback_events
  WHERE object_type = 'signal' AND object_id = OLD.id::text;
  RETURN OLD;
END;
$$;

CREATE TRIGGER cleanup_signal_feedback
  BEFORE DELETE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_signal_feedback();
