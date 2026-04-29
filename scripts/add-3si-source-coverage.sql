-- Add source coverage gaps identified by the 3Si vs Fortress Apr 17, 2026 audit.
--
-- Comparison found Fortress missed 14 of 18 (78%) of 3Si's findings. Top
-- recoverable gaps are sources 3Si reads weekly that Fortress doesn't:
--   - BC Energy Regulator (existing row but paused; native /feed 404s)
--   - Canada's National Observer (high-cited investigative outlet, 403s on /feed)
--   - CAPE (Canadian Association of Physicians for the Environment — drives the
--     "LNG health harms" narrative; native cape.ca/feed/ works)
--   - Wilderness Committee (sustained anti-LNG campaigning; native feed 404s)
--
-- For sources that block direct RSS, we use a Google News RSS search query as
-- a reliable proxy. Same pattern as existing "Google News: Dogwood BC".
--
-- Run this in: https://supabase.com/dashboard/project/kpuqukppbmwebiptqmog/sql/new

-- 1. Activate the existing BCER row with a working feed URL.
UPDATE sources
SET status = 'active',
    config = jsonb_build_object(
      'feed_url', 'https://news.google.com/rss/search?q=%22BC+Energy+Regulator%22+OR+BCER&hl=en-CA&gl=CA&ceid=CA:en',
      'keywords', ARRAY['BCER','BC Energy Regulator','levy','permit','flaring','LNG','pipeline','Petronas','CGL','Coastal GasLink']::text[],
      'rationale', 'BC Energy Regulator news. Native /feed returns 404; using Google News RSS search as proxy.'
    ),
    error_message = NULL,
    updated_at = now()
WHERE name = 'BC Energy Regulator';

-- 2. Insert Canada's National Observer (proxied via Google News).
INSERT INTO sources (name, type, status, config, monitor_type, created_at, updated_at)
VALUES (
  'Canada''s National Observer (Google News)',
  'rss',
  'active',
  jsonb_build_object(
    'feed_url', 'https://news.google.com/rss/search?q=%22Canada%27s+National+Observer%22+LNG+OR+pipeline+OR+BCER+OR+BC&hl=en-CA&gl=CA&ceid=CA:en',
    'keywords', ARRAY['LNG','pipeline','Petronas','BCER','flaring','health harm','Phase 2','Coastal GasLink']::text[],
    'rationale', 'Major Canadian environmental investigative outlet. 3Si cites them weekly. Native /feed returns 403; using Google News RSS.'
  ),
  NULL, now(), now()
)
ON CONFLICT (name) DO UPDATE SET status = 'active', config = EXCLUDED.config, updated_at = now();

-- 3. Insert CAPE (Canadian Association of Physicians for the Environment).
-- Direct feed works (cape.ca/feed/, 200 OK).
INSERT INTO sources (name, type, status, config, monitor_type, created_at, updated_at)
VALUES (
  'CAPE (Physicians for the Environment)',
  'rss',
  'active',
  jsonb_build_object(
    'feed_url', 'https://cape.ca/feed/',
    'keywords', ARRAY['LNG','pipeline','health harm','flaring','asthma','climate','BC','Phase 2','Petronas','event','forum']::text[],
    'rationale', 'CAPE drives the LNG health-harm narrative campaign. Their event listings and statements anchored 2 of the 3 main signals in 3Si Apr 17 report.'
  ),
  NULL, now(), now()
)
ON CONFLICT (name) DO UPDATE SET status = 'active', config = EXCLUDED.config, updated_at = now();

-- 4. Insert Wilderness Committee (proxied via Google News).
INSERT INTO sources (name, type, status, config, monitor_type, created_at, updated_at)
VALUES (
  'Wilderness Committee (Google News)',
  'rss',
  'active',
  jsonb_build_object(
    'feed_url', 'https://news.google.com/rss/search?q=%22Wilderness+Committee%22+LNG+OR+pipeline+OR+BC+OR+gas+OR+oil&hl=en-CA&gl=CA&ceid=CA:en',
    'keywords', ARRAY['LNG','pipeline','BC','gas','oil','Petronas','Phase 2','Coastal GasLink','Adrian Dix']::text[],
    'rationale', 'Wilderness Committee runs sustained anti-LNG campaigns. Native feed 404s; using Google News RSS.'
  ),
  NULL, now(), now()
)
ON CONFLICT (name) DO UPDATE SET status = 'active', config = EXCLUDED.config, updated_at = now();

-- 5. Verify all four are active.
SELECT name, status, config->>'feed_url' AS feed_url
FROM sources
WHERE name IN (
  'BC Energy Regulator',
  'Canada''s National Observer (Google News)',
  'CAPE (Physicians for the Environment)',
  'Wilderness Committee (Google News)'
)
ORDER BY name;
