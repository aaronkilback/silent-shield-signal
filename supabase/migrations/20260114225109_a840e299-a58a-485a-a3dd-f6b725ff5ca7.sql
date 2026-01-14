-- Add task_force_name field to incidents table
ALTER TABLE public.incidents 
ADD COLUMN IF NOT EXISTS task_force_name TEXT;

-- Add index for efficient querying of task forces
CREATE INDEX IF NOT EXISTS idx_incidents_task_force_name ON public.incidents(task_force_name) WHERE task_force_name IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.incidents.task_force_name IS 'Unique name for multi-agent investigation task forces (e.g., Task Force Guardian, Operation Sentinel)';