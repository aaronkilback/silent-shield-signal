
-- ═══════════════════════════════════════════════════════════════════════
-- PRIORITY 1: Silent Failure Elimination — Error Logging & Dead Letter Queue
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Edge function error log — captures every failure across the platform
CREATE TABLE public.edge_function_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_code TEXT,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),
  request_context JSONB DEFAULT '{}',
  user_id UUID,
  tenant_id UUID,
  client_id UUID,
  duration_ms INTEGER,
  retry_count INTEGER DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying recent errors by function
CREATE INDEX idx_edge_errors_function_time ON public.edge_function_errors (function_name, created_at DESC);
CREATE INDEX idx_edge_errors_severity ON public.edge_function_errors (severity, created_at DESC);
CREATE INDEX idx_edge_errors_unresolved ON public.edge_function_errors (resolved_at) WHERE resolved_at IS NULL;

-- Enable RLS
ALTER TABLE public.edge_function_errors ENABLE ROW LEVEL SECURITY;

-- Only admins/super_admins can view errors
CREATE POLICY "Admins can view edge function errors"
  ON public.edge_function_errors FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.is_super_admin(auth.uid())
  );

-- Service role inserts (edge functions use service client)
CREATE POLICY "Service can insert edge function errors"
  ON public.edge_function_errors FOR INSERT
  WITH CHECK (true);

-- 2. Dead letter queue — failed operations that can be retried
CREATE TABLE public.dead_letter_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  error_id UUID REFERENCES public.edge_function_errors(id),
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'completed', 'exhausted', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_dlq_status_retry ON public.dead_letter_queue (status, next_retry_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_dlq_function ON public.dead_letter_queue (function_name, created_at DESC);

ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view dead letter queue"
  ON public.dead_letter_queue FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.is_super_admin(auth.uid())
  );

CREATE POLICY "Service can manage dead letter queue"
  ON public.dead_letter_queue FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Circuit breaker state — tracks external API health
CREATE TABLE public.circuit_breaker_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  half_open_at TIMESTAMPTZ,
  failure_threshold INTEGER NOT NULL DEFAULT 5,
  recovery_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.circuit_breaker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view circuit breaker state"
  ON public.circuit_breaker_state FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.is_super_admin(auth.uid())
  );

CREATE POLICY "Service can manage circuit breaker state"
  ON public.circuit_breaker_state FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable realtime on errors table for in-app notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.edge_function_errors;

-- 4. Auto-cleanup: remove resolved errors older than 30 days
CREATE OR REPLACE FUNCTION public.cleanup_old_errors()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM edge_function_errors
  WHERE resolved_at IS NOT NULL AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM dead_letter_queue
  WHERE status IN ('completed', 'exhausted', 'cancelled') AND created_at < NOW() - INTERVAL '30 days';
  
  RETURN deleted_count;
END;
$$;
