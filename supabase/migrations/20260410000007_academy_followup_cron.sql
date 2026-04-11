-- Fortress Academy: 30-day follow-up cron job
-- Schedule: daily at 08:00 UTC

SELECT cron.schedule(
  'academy-followup-daily',
  '0 8 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/academy-followup',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Register in cron_job_registry
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'academy-followup-daily',
  1440,
  'Transitions post_complete academy learners to followup_pending when 30-day window expires',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description               = EXCLUDED.description,
  is_critical               = EXCLUDED.is_critical;
