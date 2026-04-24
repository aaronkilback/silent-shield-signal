-- Schedule proactive-intelligence-push every 15 minutes
-- Function was built and tested (167 messages generated) but never scheduled.

SELECT cron.schedule(
  'proactive-intelligence-push-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/proactive-intelligence-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  )
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'proactive-intelligence-push-15min',
  15,
  'Proactive intelligence push — detects signal surges, unattended high-risk items, risk posture shifts, and cross-client patterns. Delivers actionable insights to users via agent_pending_messages without waiting to be asked.',
  false
)
ON CONFLICT (job_name) DO NOTHING;
