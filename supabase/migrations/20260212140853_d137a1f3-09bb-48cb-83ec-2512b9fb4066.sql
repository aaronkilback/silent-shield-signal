-- Add feedback_context column for richer metadata on feedback events
ALTER TABLE public.feedback_events 
ADD COLUMN IF NOT EXISTS feedback_context jsonb DEFAULT '{}';

-- Add correction column for analysts to specify what the correct output should have been
ALTER TABLE public.feedback_events
ADD COLUMN IF NOT EXISTS correction text;

-- Add source_function column to track which edge function generated the content
ALTER TABLE public.feedback_events
ADD COLUMN IF NOT EXISTS source_function text;

-- Create universal_learning_log to track what the feedback engine has processed
CREATE TABLE IF NOT EXISTS public.universal_learning_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_event_id uuid REFERENCES public.feedback_events(id) ON DELETE CASCADE,
  object_type text NOT NULL,
  learning_action text NOT NULL, -- e.g. 'updated_profile', 'adjusted_prompt', 'suppressed_pattern'
  profile_types_updated text[] DEFAULT '{}',
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.universal_learning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view learning logs"
ON public.universal_learning_log FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage learning logs"
ON public.universal_learning_log FOR ALL
USING (true)
WITH CHECK (true);

-- Add index for efficient feedback queries
CREATE INDEX IF NOT EXISTS idx_feedback_events_object_type_created 
ON public.feedback_events(object_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_universal_learning_log_object_type 
ON public.universal_learning_log(object_type, created_at DESC);