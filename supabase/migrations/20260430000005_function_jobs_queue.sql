-- Durable async job queue for edge functions.
--
-- Background:
-- The codebase had ~14 fire-and-forget patterns where one edge function
-- triggered another via fetch(...).catch(...) or supabase.from(...).then().
-- The Supabase Edge runtime tears down each function after its response
-- returns, killing in-flight async work. This caused the entire
-- agent-enrichment-gap class of bugs investigated 2026-04-30 — composite
-- writes never landed, review-signal-agent never fired, audit rows never
-- inserted.
--
-- This queue replaces the fire-and-forget pattern with a durable handoff:
-- the producer enqueues a row in function_jobs and returns; the
-- job-worker function (scheduled every minute via pg_cron) claims pending
-- jobs with FOR UPDATE SKIP LOCKED, awaits the handler, marks the row
-- completed or failed with retry. Edge runtime teardown no longer matters
-- because the work outlives the producer.
--
-- DLQ: failed jobs (attempts >= max_attempts) stay in this table with
-- status='failed' and error_message populated. The watchdog reads them
-- via the function_jobs_failed_24h view.

CREATE TABLE IF NOT EXISTS public.function_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  scheduled_for   timestamptz NOT NULL DEFAULT NOW(),
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  result          jsonb,
  -- Optional idempotency key — producer can supply this to prevent
  -- duplicate enqueues for the same logical operation. NULL means
  -- no idempotency check.
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Worker claim query: pull pending jobs whose scheduled_for has elapsed,
-- ordered by created_at, FOR UPDATE SKIP LOCKED so multiple workers do
-- not double-process. This index makes that query O(batch_size).
CREATE INDEX IF NOT EXISTS idx_function_jobs_pending_due
  ON public.function_jobs (scheduled_for, created_at)
  WHERE status = 'pending';

-- DLQ + observability views need fast access to non-pending rows.
CREATE INDEX IF NOT EXISTS idx_function_jobs_status_completed
  ON public.function_jobs (status, completed_at DESC)
  WHERE status IN ('completed', 'failed');

-- Idempotency lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_function_jobs_idempotency_key
  ON public.function_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'in_progress', 'completed');

-- Per-job-type rollups (for the watchdog and dashboards)
CREATE INDEX IF NOT EXISTS idx_function_jobs_type_created
  ON public.function_jobs (job_type, created_at DESC);

-- Operator view: failed jobs in the last 24h (the DLQ).
CREATE OR REPLACE VIEW public.function_jobs_failed_24h AS
SELECT
  job_type,
  COUNT(*)::int AS failed_count,
  MIN(completed_at) AS oldest_failure,
  MAX(completed_at) AS most_recent_failure,
  array_agg(DISTINCT (LEFT(error_message, 80))) FILTER (WHERE error_message IS NOT NULL) AS error_samples
FROM public.function_jobs
WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours'
GROUP BY job_type
ORDER BY failed_count DESC;

-- Operator view: job throughput in the last 24h (success rate, p50 latency).
CREATE OR REPLACE VIEW public.function_jobs_throughput_24h AS
SELECT
  job_type,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
  COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
  COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress'))::int AS in_flight,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0), 1) AS success_pct,
  ROUND(EXTRACT(EPOCH FROM PERCENTILE_CONT(0.50) WITHIN GROUP (
    ORDER BY (completed_at - started_at)
  )) * 1000)::int AS p50_ms,
  ROUND(EXTRACT(EPOCH FROM PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY (completed_at - started_at)
  )) * 1000)::int AS p95_ms,
  AVG(attempts)::numeric(4, 2) AS avg_attempts
FROM public.function_jobs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY job_type
ORDER BY total DESC;

-- RLS: super_admin SELECT for dashboards/watchdog; service_role full access
-- for the producer helper and worker.
ALTER TABLE public.function_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "function_jobs_super_admin_read" ON public.function_jobs;
CREATE POLICY "function_jobs_super_admin_read" ON public.function_jobs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "function_jobs_service_role_all" ON public.function_jobs;
CREATE POLICY "function_jobs_service_role_all" ON public.function_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.function_jobs IS
  'Durable async job queue for edge functions. Producers (call sites that previously fire-and-forgot) write rows here. The job-worker function drains them every minute via pg_cron, with retry + DLQ. See _shared/queue.ts for the producer helper.';

COMMENT ON COLUMN public.function_jobs.idempotency_key IS
  'Optional unique key to prevent duplicate enqueues. Producers can supply this when a logical operation must run at most once (e.g. signal_id+stage). Unique index covers pending/in_progress/completed states.';
