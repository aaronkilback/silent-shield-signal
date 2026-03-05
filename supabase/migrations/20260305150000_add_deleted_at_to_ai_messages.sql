-- Add soft-delete support to ai_assistant_messages
ALTER TABLE public.ai_assistant_messages
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Index for efficient filtering of non-deleted messages
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_deleted_at
ON public.ai_assistant_messages(deleted_at) WHERE deleted_at IS NULL;
