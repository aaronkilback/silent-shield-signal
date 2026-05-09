-- Adds Reddit RSS sources for activism coverage and re-schedules
-- monitor-twitter cron (was disabled when X API budget hit zero).
-- Reddit recipe per cookbook follow-up: cheapest activism volume
-- multiplier short of re-enabling Twitter.

-- ─── Reddit RSS sources ───────────────────────────────────────────────────
-- Two subreddits + three search-based feeds. monitor-rss-sources reads
-- config.feed_url and processes each item through ingest-signal — so the
-- ingest-signal source_domain novelty tracking + relevance gate apply
-- automatically.

INSERT INTO public.sources (name, type, status, config)
VALUES
  (
    'Reddit r/britishcolumbia',
    'rss',
    'active',
    jsonb_build_object(
      'feed_url', 'https://www.reddit.com/r/britishcolumbia/.rss',
      'keywords', ARRAY['protest','blockade','pipeline','LNG','First Nation','court','activist','Coastal GasLink']
    )
  ),
  (
    'Reddit r/CanadaPolitics',
    'rss',
    'active',
    jsonb_build_object(
      'feed_url', 'https://www.reddit.com/r/CanadaPolitics/.rss',
      'keywords', ARRAY['protest','pipeline','First Nation','Wet''suwet''en','Indigenous','injunction','blockade']
    )
  ),
  (
    'Reddit search — Coastal GasLink',
    'rss',
    'active',
    jsonb_build_object(
      'feed_url', 'https://www.reddit.com/search.rss?q=Coastal+GasLink&sort=new&t=week',
      'keywords', ARRAY['Coastal GasLink','CGL','pipeline','protest','blockade']
    )
  ),
  (
    'Reddit search — Wet''suwet''en',
    'rss',
    'active',
    jsonb_build_object(
      'feed_url', 'https://www.reddit.com/search.rss?q=Wet%27suwet%27en&sort=new&t=month',
      'keywords', ARRAY['Wet''suwet''en','land defender','Gidimt''en','Unist''ot''en','Coastal GasLink','blockade']
    )
  ),
  (
    'Reddit search — gender clinic protest',
    'rss',
    'active',
    jsonb_build_object(
      'feed_url', 'https://www.reddit.com/search.rss?q=%22gender+clinic%22+OR+%22BCCH%22+protest&sort=new&t=month',
      'keywords', ARRAY['gender clinic','BCCH','protest','rally','BC Children''s Hospital']
    )
  )
ON CONFLICT DO NOTHING;


-- ─── Re-enable monitor-twitter cron ───────────────────────────────────────
-- Function exists and handles 429s gracefully — so re-enabling is safe
-- even if the X API budget is still depleted. As soon as a budget refill
-- lands, signals start flowing without another deploy.
-- 30-min schedule is conservative for the free tier (1 req per 15 min,
-- 500k reads/month).

DO $$
DECLARE existing bigint;
BEGIN
  SELECT jobid INTO existing FROM cron.job WHERE jobname = 'monitor-twitter-30min';
  IF existing IS NOT NULL THEN
    PERFORM cron.unschedule(existing);
  END IF;
END $$;

SELECT cron.schedule(
  'monitor-twitter-30min',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-twitter',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Registry entry so watchdog measures it
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('monitor-twitter-30min', 30, 'Twitter API v2 search for client + entity matches', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description;
