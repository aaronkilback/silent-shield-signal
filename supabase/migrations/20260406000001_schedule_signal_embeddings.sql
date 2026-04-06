-- =============================================================================
-- Schedule signal embedding cron job
-- generate-embeddings with embed_signals action embeds recent signals into
-- global_docs for semantic search / detect-duplicates. Without this cron,
-- content_embedding is never populated and semantic dedup is blind.
-- Runs every 30 minutes, matching the social monitor cadence.
-- =============================================================================

SELECT cron.schedule('embed-signals-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/generate-embeddings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"action": "embed_signals", "limit": 50}'::jsonb
  );
$$);
