-- Add diary_date column to workspace_tasks for MCM compliance
-- In MCM, diary dates are critical for tracking investigative progress
ALTER TABLE public.workspace_tasks ADD COLUMN IF NOT EXISTS diary_date timestamp with time zone;

-- Add comment explaining the field
COMMENT ON COLUMN public.workspace_tasks.diary_date IS 'MCM diary date - the date by which progress must be reviewed/reported';