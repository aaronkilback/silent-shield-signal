-- Add workflow tracking fields to bug_reports
ALTER TABLE public.bug_reports 
  ADD COLUMN IF NOT EXISTS reporter_email text,
  ADD COLUMN IF NOT EXISTS conversation_log jsonb,
  ADD COLUMN IF NOT EXISTS test_results jsonb,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS assigned_to text,
  ADD COLUMN IF NOT EXISTS workflow_stage text DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS fix_verified boolean DEFAULT false;

-- Create index for workflow tracking
CREATE INDEX IF NOT EXISTS idx_bug_reports_workflow ON public.bug_reports(workflow_stage, status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON public.bug_reports(created_at DESC);

-- Update status to include more workflow states
COMMENT ON COLUMN public.bug_reports.workflow_stage IS 'Stages: reported, investigating, fix_proposed, fix_approved, fix_implementing, testing, verified, closed';
COMMENT ON COLUMN public.bug_reports.verification_status IS 'Status: pending, passed, failed';

-- Enable realtime for bug_reports so users get live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.bug_reports;