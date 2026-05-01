-- Structured per-function-call telemetry for edge functions.
-- Currently we have edge_function_errors (only on failure) and api_usage_logs
-- (auth-key request count, no AI cost), with no visibility into:
--   - latency p50/p99/p999 per function
--   - which AI provider+model handled which call
--   - tokens consumed per function (cost attribution)
--   - error rate per function
--
-- Today during the agent-enrichment-gap investigation we had to guess every
-- step because there was no telemetry to query. This table closes that gap.
-- It is append-only and small per row (no full prompts/responses), safe to
-- write from every AI call without bloating storage.

CREATE TABLE IF NOT EXISTS public.function_telemetry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT NOW(),
  duration_ms     integer,
  status          text NOT NULL CHECK (status IN ('success', 'error', 'timeout', 'circuit_open')),
  -- AI-specific (NULL if the call was not an AI invocation)
  ai_provider     text,         -- 'openai' | 'gemini' | 'perplexity'
  ai_model        text,         -- 'gpt-5.2', 'gemini-2.5-flash', 'sonar', etc
  tokens_in       integer,
  tokens_out      integer,
  -- Error-specific (NULL on success)
  error_class     text,         -- 'rate_limit' | 'timeout' | 'invalid_response' | 'auth' | 'other'
  error_message   text,
  -- Generic context for ad-hoc debugging
  context         jsonb DEFAULT '{}'::jsonb
);

-- High-cardinality reads: function_name + time window, status, model.
CREATE INDEX IF NOT EXISTS idx_function_telemetry_function_time
  ON public.function_telemetry (function_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_telemetry_status
  ON public.function_telemetry (status, started_at DESC) WHERE status != 'success';
CREATE INDEX IF NOT EXISTS idx_function_telemetry_model
  ON public.function_telemetry (ai_model, started_at DESC) WHERE ai_model IS NOT NULL;

-- Retention: keep 30 days of telemetry. With ~10k AI calls/day and ~1KB/row
-- that's ~300MB. Older data should age into aggregated rollups.
CREATE INDEX IF NOT EXISTS idx_function_telemetry_started_at
  ON public.function_telemetry (started_at);

-- Operator-friendly view: per-function p50/p95/p99 latency, success rate,
-- token spend over last 24h. Read this in the watchdog or dashboards.
CREATE OR REPLACE VIEW public.function_telemetry_24h AS
SELECT
  function_name,
  COUNT(*)::int AS calls,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / NULLIF(COUNT(*), 0), 1) AS success_pct,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
  SUM(tokens_in)::bigint AS tokens_in_total,
  SUM(tokens_out)::bigint AS tokens_out_total,
  COUNT(*) FILTER (WHERE status != 'success')::int AS errors,
  array_agg(DISTINCT ai_model) FILTER (WHERE ai_model IS NOT NULL) AS models_used
FROM public.function_telemetry
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY function_name
ORDER BY calls DESC;

-- RLS: super_admin only. This table contains operational telemetry, not
-- per-tenant data, so it must not leak across tenants via RLS misconfig.
ALTER TABLE public.function_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "function_telemetry_super_admin_read" ON public.function_telemetry;
CREATE POLICY "function_telemetry_super_admin_read" ON public.function_telemetry
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "function_telemetry_service_role_write" ON public.function_telemetry;
CREATE POLICY "function_telemetry_service_role_write" ON public.function_telemetry
  FOR INSERT TO service_role
  WITH CHECK (true);

COMMENT ON TABLE public.function_telemetry IS
  'Per-call observability for edge functions. Append-only. Written by _shared/observability.ts (recordTelemetry helper). Read via function_telemetry_24h view.';
