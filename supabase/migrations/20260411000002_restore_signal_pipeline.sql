-- =============================================================================
-- Restore signal pipeline for PETRONAS testing
-- Date: 2026-04-11
--
-- Problems fixed:
--   1. rejected_content_hashes has accumulated months of hashes — pruning
--      entries older than 30 days so previously-seen content can re-enter
--      the pipeline as fresh signals
--   2. Adding working RSS sources to the sources table that cover PETRONAS-
--      relevant topics with daily output (regulatory, energy sector, BC news)
--   3. Re-enabling BC Government News explicitly (URL was fixed 2026-04-09)
-- =============================================================================

-- 1. Prune rejected_content_hashes older than 30 days
--    These accumulate indefinitely and block re-ingestion of recurring topics.
--    30-day window baligns with the dedup windows used in ingest-signal and
--    process-intelligence-document.
DELETE FROM public.rejected_content_hashes
WHERE created_at < NOW() - INTERVAL '30 days';

-- 2. Add index on created_at if not already present (enables efficient future pruning)
CREATE INDEX IF NOT EXISTS idx_rejected_content_hashes_created_at
  ON public.rejected_content_hashes (created_at);

-- 3. Confirm BC Government News is active with correct URL
UPDATE public.sources
SET
  status     = 'active',
  config     = jsonb_set(COALESCE(config, '{}'::jsonb), '{feed_url}', '"https://news.gov.bc.ca/feed"'::jsonb),
  error_message = NULL,
  updated_at = NOW()
WHERE name = 'BC Government News'
  AND status != 'active';

-- 4. Add new reliable sources (upsert-safe: delete if exists, then insert)
DELETE FROM public.sources WHERE name IN (
  'Natural Resources Canada News',
  'CBC British Columbia',
  'Reuters Business News',
  'CBC Canada National'
);

INSERT INTO public.sources (name, type, status, config) VALUES
  ('Natural Resources Canada News', 'rss', 'active', '{"feed_url": "https://natural-resources.canada.ca/api/news/en.rss"}'::jsonb),
  ('CBC British Columbia',          'rss', 'active', '{"feed_url": "https://www.cbc.ca/cmlink/rss-canada-britishcolumbia"}'::jsonb),
  ('Reuters Business News',         'rss', 'active', '{"feed_url": "https://feeds.reuters.com/reuters/businessNews"}'::jsonb),
  ('CBC Canada National',           'rss', 'active', '{"feed_url": "https://www.cbc.ca/cmlink/rss-canada"}'::jsonb);

-- 8. Update BC Energy Regulator (replaced BC Oil Gas Commission)
UPDATE public.sources
SET
  name          = 'BC Energy Regulator',
  status        = 'active',
  config        = '{"feed_url": "https://www.bc-er.ca/news-and-updates/news-releases/feed/"}'::jsonb,
  error_message = NULL,
  updated_at    = NOW()
WHERE name IN ('BC Oil Gas Commission', 'BC Energy Regulator');
