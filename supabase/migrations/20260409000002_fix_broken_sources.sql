-- =============================================================================
-- Fix broken RSS/feed sources
-- Date: 2026-04-09
--
-- Categorized issues found via diagnose_issues + read_client_monitoring_config:
--
--   1. BC Government News         → 404 (wrong URL)         → FIXED
--   2. Dawson Creek Mirror        → DNS failure             → PAUSED
--   3. Alaska Highway News        → DNS failure             → PAUSED
--   4. RCMP Press Releases        → SSL UnknownIssuer       → PAUSED
--   5. BC Wildfire Service        → SSL NotValidForName     → PAUSED (also redundant:
--                                                              replaced by AEGIS
--                                                              get_wildfire_intelligence)
--   6. Prince George Citizen      → 404 (feed path wrong)  → PAUSED
--   7. Podcast: Shawn Ryan Show   → 404                    → PAUSED
--   8. BC Oil Gas Commission      → 404 (agency renamed)   → PAUSED
--   9. YouTube sources (6)        → 404 (wrong channel ID) → PAUSED
--      (YouTube RSS works from Supabase; channel IDs need manual lookup)
--
-- Nitter sources (3) were already paused.
-- Twitter/X, HIBP, Reddit, DriveBC, Pastebin, Natural Resources Canada, and CSIS
-- remain active — those are API-type sources or have intermittent network issues.
-- =============================================================================

-- 1. Fix BC Government News — new URL verified working 2026-04-09
UPDATE public.sources
SET
  config = jsonb_set(COALESCE(config, '{}'::jsonb), '{feed_url}', '"https://news.gov.bc.ca/feed"'::jsonb),
  error_message = NULL,
  updated_at = NOW()
WHERE name = 'BC Government News';

-- 2. Pause dead-domain sources (DNS no longer resolves)
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'Domain does not resolve — source appears permanently offline',
  updated_at = NOW()
WHERE name IN ('Dawson Creek Mirror', 'Alaska Highway News');

-- 3. Pause RCMP RSS — SSL certificate rejected by Supabase Deno runtime
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'SSL cert error (UnknownIssuer) in Supabase Deno runtime — rcmp-grc.gc.ca uses a certificate not trusted by the Deno TLS store',
  updated_at = NOW()
WHERE name = 'RCMP Press Releases';

-- 4. Pause BC Wildfire Service feed — replaced by live BC OpenMaps WFS data
--    via the AEGIS get_wildfire_intelligence tool (deployed 2026-04-08)
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'Superseded by live BC OpenMaps WFS feed in AEGIS get_wildfire_intelligence tool; SSL cert also invalid for bcwildfire.ca',
  updated_at = NOW()
WHERE name = 'BC Wildfire Service';

-- 5. Pause Prince George Citizen — RSS feed path returns 404
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'RSS feed path returns 404 — verify correct feed URL (try /feed/ or /rss/)',
  updated_at = NOW()
WHERE name = 'Prince George Citizen';

-- 6. Pause Shawn Ryan Show podcast RSS — 404
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'Podcast RSS URL returns 404 — update config.feed_url with current Shawn Ryan Show podcast feed',
  updated_at = NOW()
WHERE name = 'Podcast: Shawn Ryan Show RSS';

-- 7. Pause BC Oil Gas Commission — renamed BC Energy Regulator (BCER)
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'BC Oil Gas Commission renamed to BC Energy Regulator (BCER) — update config.feed_url to new BCER news RSS endpoint',
  updated_at = NOW()
WHERE name = 'BC Oil Gas Commission';

-- 8. Pause YouTube sources with wrong/missing channel IDs
--    YouTube RSS works from Supabase (verified 2026-04-09); these all return 404
--    meaning channel IDs in config are wrong.
--    To re-enable: go to each channel page, click View Page Source,
--    search for "externalChannelId", and update config.feed_url to:
--    https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
UPDATE public.sources
SET
  status = 'paused',
  error_message = 'YouTube RSS URL has wrong channel ID — find the correct channel ID from the channel page source (externalChannelId) and update config.feed_url to https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID',
  updated_at = NOW()
WHERE name IN (
  'YouTube: CISA Cybersecurity',
  'YouTube: Shawn Ryan Show',
  'YouTube: Forward Observer - Sam Culper',
  'YouTube: Fieldcraft Survival - Mike Glover',
  'YouTube: Recorded Future Threat Intel',
  'YouTube: Centre for International Governance Innovation'
)
AND type = 'rss';
