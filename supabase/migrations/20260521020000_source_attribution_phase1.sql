-- ════════════════════════════════════════════════════════════════════════════
-- #120 Phase 1 — Source attribution: bounded high-trust-impact fixes
--
-- Three categories addressed:
--   (A) Curator-seed signals (21 / 16 publishers)
--   (B) CISA-KEV signals (16)
--   (C) PATTERN internal signals (54)
--
-- Excluded (filed as #125): the 280 other_external signals where source_url
-- is present but source_key was never passed. Per-monitor investigation
-- needed.
--
-- Idempotent: source upserts use INSERT...WHERE NOT EXISTS (sources.name has
-- no unique constraint). Backfills use WHERE source_id IS NULL guards.
-- Re-running has no effect on already-attributed signals.
--
-- Tracking: closes Phase 1 of #120 (#114.1). Parent #114, umbrella #102.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- A1. Register the "Fortress Pattern Detector" internal source
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.sources (name, type, status, monitor_type)
SELECT 'Fortress Pattern Detector', 'manual', 'active', 'internal-pattern'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sources WHERE name = 'Fortress Pattern Detector'
);

-- ───────────────────────────────────────────────────────────────────────────
-- A2. Register per-publisher source rows for curator-seed publishers
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.sources (name, type, status, monitor_type)
SELECT v.name, 'manual', 'active', 'operator-curated'
FROM (VALUES
  ('CBC News'),
  ('The Tyee'),
  ('TransLink'),
  ('Rolling Stone'),
  ('Daily Hive'),
  ('Pivot Legal Society'),
  ('The Globe and Mail'),
  ('The PRP'),
  ('City of Vancouver'),
  ('FIFA Vancouver 2026'),
  ('BC Place Official'),
  ('Variety'),
  ('DroneXL'),
  ('Global News'),
  ('NAV CANADA'),
  ('PBI Canada')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sources s WHERE s.name = v.name
);

-- ───────────────────────────────────────────────────────────────────────────
-- B1. Backfill PATTERN signals → Fortress Pattern Detector
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.signals s
SET source_id = (SELECT id FROM public.sources WHERE name = 'Fortress Pattern Detector' LIMIT 1)
WHERE s.source_id IS NULL
  AND s.signal_type = 'pattern'
  AND s.created_at > NOW() - INTERVAL '30 days';

-- ───────────────────────────────────────────────────────────────────────────
-- B2. Backfill CISA-KEV signals → cisa-kev source
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.signals s
SET source_id = (SELECT id FROM public.sources WHERE name = 'cisa-kev' LIMIT 1)
WHERE s.source_id IS NULL
  AND s.source_url ILIKE '%cisa.gov/known-exploited-vulnerabilities-catalog%'
  AND s.created_at > NOW() - INTERVAL '30 days';

-- ───────────────────────────────────────────────────────────────────────────
-- B3. Backfill curator-seed signals → per-publisher source rows
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.signals s
SET source_id = pub.id
FROM (SELECT id, name FROM public.sources WHERE type = 'manual' AND monitor_type = 'operator-curated') pub
WHERE s.source_id IS NULL
  AND s.source_url IS NOT NULL
  AND (s.raw_json ->> 'curator_seed' = 'true' OR s.raw_json ->> 'seed_type' = 'authoritative_curated_osint')
  AND s.created_at > NOW() - INTERVAL '30 days'
  AND pub.name = CASE regexp_replace(regexp_replace(s.source_url, '^https?://(www\.)?', ''), '/.*', '')
    WHEN 'cbc.ca'              THEN 'CBC News'
    WHEN 'thetyee.ca'          THEN 'The Tyee'
    WHEN 'translink.ca'        THEN 'TransLink'
    WHEN 'rollingstone.com'    THEN 'Rolling Stone'
    WHEN 'dailyhive.com'       THEN 'Daily Hive'
    WHEN 'pivotlegal.org'      THEN 'Pivot Legal Society'
    WHEN 'theglobeandmail.com' THEN 'The Globe and Mail'
    WHEN 'theprp.com'          THEN 'The PRP'
    WHEN 'vancouver.ca'        THEN 'City of Vancouver'
    WHEN 'vancouverfwc26.ca'   THEN 'FIFA Vancouver 2026'
    WHEN 'bcplace.com'         THEN 'BC Place Official'
    WHEN 'variety.com'         THEN 'Variety'
    WHEN 'dronexl.co'          THEN 'DroneXL'
    WHEN 'globalnews.ca'       THEN 'Global News'
    WHEN 'navcanada.ca'        THEN 'NAV CANADA'
    WHEN 'pbicanada.org'       THEN 'PBI Canada'
    ELSE NULL
  END;
