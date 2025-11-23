-- Add fix proposal fields to bug_reports table
ALTER TABLE bug_reports 
ADD COLUMN IF NOT EXISTS fix_proposal jsonb,
ADD COLUMN IF NOT EXISTS fix_status text DEFAULT 'no_fix',
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS implemented_at timestamp with time zone;

-- Add check constraint for fix_status
ALTER TABLE bug_reports 
DROP CONSTRAINT IF EXISTS bug_reports_fix_status_check;

ALTER TABLE bug_reports 
ADD CONSTRAINT bug_reports_fix_status_check 
CHECK (fix_status IN ('no_fix', 'proposal_ready', 'approved', 'implemented', 'rejected'));

-- Create index for querying by fix_status
CREATE INDEX IF NOT EXISTS idx_bug_reports_fix_status ON bug_reports(fix_status);

COMMENT ON COLUMN bug_reports.fix_proposal IS 'JSON containing: root_cause, fix_strategy, code_changes[], affected_files[], testing_steps[], deployment_notes[]';
COMMENT ON COLUMN bug_reports.fix_status IS 'Status of fix: no_fix, proposal_ready, approved, implemented, rejected';