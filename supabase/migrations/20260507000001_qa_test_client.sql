-- Create a dedicated inactive client for fortress-qa-agent fixtures.
-- Background: until 2026-05-07 the QA agent injected synthetic signals
-- against the Petronas Canada client. ~138 fabricated signals,
-- 6 incidents, and 71 reports leaked into the live feed before audit.
-- The QA agent now targets this row (status='inactive' so it never
-- surfaces in active-client UI), and ingest-signal rejects is_test=true
-- writes against any active client.

INSERT INTO public.clients (name, organization, industry, status, monitoring_keywords)
SELECT
  '_qa_test_client',
  'Fortress QA Fixture (do not delete)',
  'internal',
  'inactive',
  ARRAY['qa-test']::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = '_qa_test_client');
