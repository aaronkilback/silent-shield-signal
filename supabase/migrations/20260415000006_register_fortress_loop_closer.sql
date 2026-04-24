-- Register fortress-loop-closer in cron_job_registry so validate-cron-alignment.mjs
-- can monitor it. The function was previously scheduled (20260306250000) but never
-- registered here, making it invisible to the watchdog.

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'fortress-loop-closer-6h',
  360,
  'Closes intelligence loops every 6h: hypothesis trees, agent accuracy tracking, analyst preferences, escalation rules, specialist learning, scan results, debate records, prediction resolution',
  true
)
ON CONFLICT (job_name) DO NOTHING;
