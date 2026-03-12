-- Rate limiting infrastructure for edge functions
-- Tracks request counts per user per function per minute window

CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,  -- TEXT to support both UUID users and IP-based keys
  function_name TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  request_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, function_name, window_start)
);

CREATE INDEX idx_rate_limit_user_fn_window ON public.rate_limit_log(user_id, function_name, window_start);

-- Clean up windows older than 1 hour automatically via a periodic function
-- (Called opportunistically from the edge function, not via cron)

-- SECURITY DEFINER function to safely upsert rate limit records and return allow/deny
CREATE OR REPLACE FUNCTION public.upsert_rate_limit(
  p_user_id TEXT,
  p_function_name TEXT,
  p_window_start TIMESTAMPTZ,
  p_max_requests INT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.rate_limit_log(user_id, function_name, window_start, request_count)
  VALUES (p_user_id, p_function_name, p_window_start, 1)
  ON CONFLICT (user_id, function_name, window_start)
  DO UPDATE SET request_count = rate_limit_log.request_count + 1
  RETURNING request_count INTO v_count;

  -- Opportunistic cleanup: delete windows older than 1 hour
  DELETE FROM public.rate_limit_log
  WHERE window_start < NOW() - INTERVAL '1 hour';

  RETURN json_build_object(
    'allowed', v_count <= p_max_requests,
    'remaining', GREATEST(0, p_max_requests - v_count),
    'count', v_count
  );
END;
$$;

-- RLS: users can only see their own rate limit records; edge functions use SECURITY DEFINER
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_see_own_rate_limits"
ON public.rate_limit_log FOR SELECT
TO authenticated
USING (user_id = auth.uid()::text);
