-- Register the entity maintenance cron jobs in the watchdog registry
-- so the watchdog alerts if they miss their scheduled windows.

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('auto-archive-stale-entities', 10080, 'Weekly Sunday 3am UTC — archives entities with quality_score < 5, created > 30 days ago, not on watch list', false)
ON CONFLICT (job_name) DO NOTHING;
