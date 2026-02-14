-- Schedule agent-self-learning to run proactively every 8 hours
SELECT cron.schedule(
  'agent-self-learning-proactive-8h',
  '0 */8 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/agent-self-learning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
    ),
    body := '{"mode":"proactive","max_queries":3}'::jsonb
  )
  $$
);