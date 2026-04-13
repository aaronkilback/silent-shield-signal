-- =============================================================================
-- Schedule monitor-macro-indicators
-- Date: 2026-04-12
--
-- Runs daily at 06:15 UTC (23:15 MST / 00:15 MDT) — after overnight data
-- updates from commodity exchanges and before the morning briefing cycle.
--
-- Sources:
--   1. Yahoo Finance (no key) — copper, WTI crude, natural gas, aluminum
--   2. CAD/USD exchange rate — Yahoo Finance (no key)
--   3. Polymarket public API (no key) — Canadian labour/political markets
--
-- Generates signals when commodity price thresholds are crossed or
-- prediction market probabilities reach operational significance.
-- Stores historical readings in macro_indicators for trend analysis.
-- =============================================================================

SELECT cron.schedule(
  'monitor-macro-indicators-6am',
  '15 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-macro-indicators',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('monitor-macro-indicators-6am', 1440, 'Daily commodity price and prediction market monitoring — generates macro risk signals when thresholds are crossed (copper, diesel, natural gas, aluminum, Polymarket)', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description;
