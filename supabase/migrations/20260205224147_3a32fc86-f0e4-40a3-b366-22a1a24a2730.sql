-- Create table to store scheduled pipeline test results
CREATE TABLE IF NOT EXISTS public.pipeline_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id UUID NOT NULL,
  test_name TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'skip')),
  duration_ms INTEGER,
  error_message TEXT,
  error_stack TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying recent results
CREATE INDEX idx_pipeline_test_results_created ON pipeline_test_results(created_at DESC);
CREATE INDEX idx_pipeline_test_results_run ON pipeline_test_results(test_run_id);
CREATE INDEX idx_pipeline_test_results_status ON pipeline_test_results(status);

-- Enable RLS
ALTER TABLE public.pipeline_test_results ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role can manage pipeline tests"
ON public.pipeline_test_results
FOR ALL
USING (true)
WITH CHECK (true);

-- Allow authenticated users to view results
CREATE POLICY "Authenticated users can view pipeline tests"
ON public.pipeline_test_results
FOR SELECT
TO authenticated
USING (true);

-- Add comment
COMMENT ON TABLE public.pipeline_test_results IS 'Stores results from scheduled functional pipeline tests that exercise real code paths';