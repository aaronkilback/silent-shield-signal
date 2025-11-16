-- Create processing queue table for scalable task management
CREATE TABLE IF NOT EXISTS public.processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL, -- 'signal_processing', 'incident_escalation', 'alert_delivery'
  entity_id UUID NOT NULL, -- ID of the signal, incident, or alert to process
  priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON public.processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_priority ON public.processing_queue(priority, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_processing_queue_task_type ON public.processing_queue(task_type);
CREATE INDEX IF NOT EXISTS idx_processing_queue_entity ON public.processing_queue(entity_id);

-- RLS policies for processing queue
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage queue"
  ON public.processing_queue
  FOR ALL
  USING (true);

CREATE POLICY "Analysts and admins can view queue"
  ON public.processing_queue
  FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Trigger to update updated_at
CREATE TRIGGER update_processing_queue_updated_at
  BEFORE UPDATE ON public.processing_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to add signal to processing queue
CREATE OR REPLACE FUNCTION public.enqueue_signal_processing(signal_id UUID, priority_level INTEGER DEFAULT 5)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  queue_id UUID;
BEGIN
  -- Check if signal is already in queue
  SELECT id INTO queue_id
  FROM processing_queue
  WHERE entity_id = signal_id 
    AND task_type = 'signal_processing'
    AND status IN ('pending', 'processing');
  
  -- If not in queue, add it
  IF queue_id IS NULL THEN
    INSERT INTO processing_queue (task_type, entity_id, priority)
    VALUES ('signal_processing', signal_id, priority_level)
    RETURNING id INTO queue_id;
  END IF;
  
  RETURN queue_id;
END;
$$;

-- Function to clean up old completed/failed tasks (older than 7 days)
CREATE OR REPLACE FUNCTION public.cleanup_processing_queue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM processing_queue
  WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;