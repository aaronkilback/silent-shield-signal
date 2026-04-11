-- =============================================================================
-- Schedule monitor-darkweb, monitor-pastebin, monitor-github
-- Date: 2026-04-11
--
-- These functions existed but had no cron schedules. All three have been
-- updated to route through ingest-signal (proper dedup) and write heartbeats.
--
-- monitor-darkweb: uses HIBP API key (configured). Every 6h.
-- monitor-pastebin: scrapes Pastebin public archive. Every 6h.
-- monitor-github: uses GITHUB_TOKEN if configured; exits gracefully without it. Every 6h.
-- =============================================================================

-- Schedule monitor-darkweb every 6 hours (offset to avoid pile-up with other 6h jobs)
SELECT cron.schedule(
  'monitor-darkweb-6h',
  '15 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-darkweb',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Schedule monitor-pastebin every 6 hours
SELECT cron.schedule(
  'monitor-pastebin-6h',
  '30 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-pastebin',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Schedule monitor-github every 6 hours
SELECT cron.schedule(
  'monitor-github-6h',
  '45 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-github',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Register in cron_job_registry
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('monitor-darkweb-6h',   360, 'HIBP breach and paste monitoring for client domains', false),
  ('monitor-pastebin-6h',  360, 'Pastebin public archive scan for client data leaks', false),
  ('monitor-github-6h',    360, 'GitHub code search for credential/secret exposures (requires GITHUB_TOKEN)', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description;
