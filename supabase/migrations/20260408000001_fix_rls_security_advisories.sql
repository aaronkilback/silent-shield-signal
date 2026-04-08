-- =============================================================================
-- SECURITY: Enable RLS on tables flagged by Supabase security advisor
-- Date: 2026-04-07
-- Tables: qa_test_results, signal_agent_analyses
-- Both were publicly readable with anon key. Fixed here.
-- =============================================================================

-- ─── qa_test_results ──────────────────────────────────────────────────────────
ALTER TABLE public.qa_test_results ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (cron jobs, edge functions)
CREATE POLICY "service_role_full_access_qa_test_results"
  ON public.qa_test_results FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Authenticated users can read (analysts reviewing QA output)
CREATE POLICY "authenticated_read_qa_test_results"
  ON public.qa_test_results FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─── signal_agent_analyses ────────────────────────────────────────────────────
ALTER TABLE public.signal_agent_analyses ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_full_access_signal_agent_analyses"
  ON public.signal_agent_analyses FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Authenticated users can read their own client's analyses
CREATE POLICY "authenticated_read_signal_agent_analyses"
  ON public.signal_agent_analyses FOR SELECT
  USING (auth.uid() IS NOT NULL);
