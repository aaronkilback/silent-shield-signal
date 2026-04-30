-- Register the 4 cron jobs that were rescheduled on 2026-04-29 but were never
-- added to public.cron_job_registry. Without these, scripts/validate-cron-alignment.mjs
-- cannot verify them and the watchdog cannot flag silent failures.
--
-- The cron schedules themselves are managed in scripts/fix-broken-crons.sql
-- (run via the Supabase SQL Editor against pg_cron).

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('monitor-naad-alerts-15min', 15, 'NAAD Canada emergency alert feed (English-language alerts only, deduped against bilingual pairs).', true),
  ('monitor-csis-6h', 360, 'CSIS public reports + Public Safety Canada national security advisories.', false),
  ('monitor-court-registry-4h', 240, 'BC Court Services + tribunal monitoring for client/entity name matches.', false),
  ('agent-self-learning-proactive-8h', 480, 'Proactive knowledge-gap research sweep across the agent fleet.', false)
ON CONFLICT (job_name) DO UPDATE
SET expected_interval_minutes = EXCLUDED.expected_interval_minutes,
    description = EXCLUDED.description,
    is_critical = EXCLUDED.is_critical;
