-- Schedule the job-worker to drain the function_jobs queue every minute.
--
-- The worker:
--   - Claims up to 25 pending jobs whose scheduled_for has elapsed
--   - Invokes the target edge function via raw fetch, awaits the response
--   - Marks completed on 2xx, retries with 60s/120s/240s/480s backoff on
--     failure, marks failed (DLQ) after max_attempts
--   - Has a soft 110s runtime budget so it always finishes before the next
--     pg_cron tick
--
-- Latency from enqueue to execution:
--   - Best case: enqueued mid-tick, picked up immediately on next minute = <60s
--   - Worst case: enqueued just after a tick = ~60s
--   - With backoff retries: 60s + 120s + 240s + 480s for a 4-attempt failure
--
-- Idempotent — unschedule + reschedule pattern matches every other cron in
-- this project (see scripts/fix-broken-crons.sql for canonical form).

SELECT cron.unschedule('job-worker-1min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-worker-1min');
SELECT cron.schedule(
  'job-worker-1min',
  '* * * * *',  -- every minute
  $cron$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- Register in cron_job_registry so validate-cron-alignment.mjs sees it as a
-- known job and the watchdog can monitor heartbeats.
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'job-worker-1min',
  1,
  'Drains function_jobs queue every minute. Replaces fire-and-forget patterns with durable async — see _shared/queue.ts.',
  true
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description,
  is_critical = EXCLUDED.is_critical;
