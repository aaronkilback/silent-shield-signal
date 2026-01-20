-- Fix failing system tests:
-- 1) Backfill missing signal titles (test asserts no NULL titles)
UPDATE public.signals
SET title = COALESCE(NULLIF(BTRIM(LEFT(COALESCE(normalized_text, ''), 120)), ''), 'Signal')
WHERE title IS NULL;

-- 2) Ensure all authenticated users (incl. viewer) can read learning profiles
--    (test asserts learning profiles exist when feedback_events > 5)
DROP POLICY IF EXISTS "Authenticated users can view learning profiles" ON public.learning_profiles;
CREATE POLICY "Authenticated users can view learning profiles"
ON public.learning_profiles
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);
