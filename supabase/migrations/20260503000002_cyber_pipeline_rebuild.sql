-- Cyber pipeline rebuild — May 2026.
--
-- Operator caught that the four cyber-feeder monitors (pastebin,
-- github, darkweb, csis) had run cleanly for the entire history of
-- the platform without ever creating a single signal. Pastebin's
-- design was structurally broken (required client name in paste
-- title — pastebin titles are typically generic). This migration:
--
--   1. Creates the cisa-kev source row + cron schedule (replaces the
--      structurally-broken pastebin monitor functionally — CISA KEV
--      is the gold-standard "cyber-threat horizon" feed: every entry
--      is a CVE actively exploited in the wild).
--
--   2. Unschedules monitor-pastebin-6h. The function stays deployed
--      so logs are preserved, but no more empty-yield runs cluttering
--      heartbeat history.
--
--   3. Tags monitor-csis as a cyber_advisory feed so its items can
--      bypass the AI relevance gate (handled in the function code,
--      not here — this migration just registers the source).

-- ─── 1. CISA KEV source + cron ───────────────────────────────────────

-- sources has no unique constraint on (name), so use idempotent
-- WHERE-NOT-EXISTS instead of ON CONFLICT.
INSERT INTO public.sources (name, type, status, monitor_type, config)
SELECT 'cisa-kev', 'api_feed', 'active', 'cyber',
  jsonb_build_object(
    'feed_url', 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    'description', 'CISA Catalog of Known Exploited Vulnerabilities — actively-exploited CVEs requiring federal-tier remediation under BOD 22-01.',
    'lookback_days', 14,
    'bypass_relevance_gate', true
  )
WHERE NOT EXISTS (SELECT 1 FROM public.sources WHERE name = 'cisa-kev');

SELECT cron.schedule(
  'monitor-cisa-kev-12h',
  '7 */12 * * *',  -- every 12h at :07 to avoid the :00 herd
  $$
    SELECT net.http_post(
      url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-cisa-kev',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

INSERT INTO public.cron_job_registry (
  job_name, expected_interval_minutes, description, is_critical
) VALUES (
  'monitor-cisa-kev-12h',
  720, -- 12h
  'CISA Known Exploited Vulnerabilities feed. Replaces structurally-broken monitor-pastebin. Pre-vetted as actively exploited; bypasses AI relevance gate via skip_relevance_gate=true.',
  false  -- not strictly critical; KEV updates daily Mon-Fri but missing 12h is recoverable
) ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;

-- ─── 2. Unschedule the broken monitor-pastebin ──────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('monitor-pastebin-6h');
EXCEPTION WHEN OTHERS THEN
  -- Already unscheduled or never existed; ignore.
  NULL;
END $$;

-- Mark it deprecated in the registry. expected_interval_minutes is
-- NOT NULL, so we set it to a sentinel large value (525600 = 1 year)
-- to keep the watchdog from missing-heartbeat alerting on it without
-- violating the NOT NULL constraint.
UPDATE public.cron_job_registry
SET expected_interval_minutes = 525600,
    description = COALESCE(description, '') || ' [DEPRECATED 2026-05-03 — structurally broken; replaced by monitor-cisa-kev. Function still deployed for log access.]',
    is_critical = false
WHERE job_name = 'monitor-pastebin-6h';

-- ─── 3. Register source rows for the cyber-advisory feeds so      ───
--      credibility tracking + dedup at ingest-signal can scope
--      properly per source.

INSERT INTO public.sources (name, type, status, monitor_type, config)
SELECT v.name, v.type, v.status, v.monitor_type, v.config
FROM (VALUES
  ('csis-public-reports', 'api_feed', 'active', 'cyber',
    jsonb_build_object('feed_url', 'https://www.canada.ca/en/security-intelligence-service.atom.xml')),
  ('cccs-cyber-advisories', 'api_feed', 'active', 'cyber',
    jsonb_build_object('feed_url', 'https://cyber.gc.ca/en/feeds/alerts-and-advisories', 'bypass_relevance_gate', true)),
  ('public-safety-canada', 'api_feed', 'active', 'cyber',
    jsonb_build_object('feed_url', 'https://www.publicsafety.gc.ca/cnt/rsrcs/pblctns/rss-eng.xml')),
  ('github-code-search', 'api_feed', 'active', 'cyber',
    jsonb_build_object('description', 'GitHub Code Search for credential-leak indicators (client domain + password/api_key/secret/token).'))
) AS v(name, type, status, monitor_type, config)
WHERE NOT EXISTS (SELECT 1 FROM public.sources s WHERE s.name = v.name);
