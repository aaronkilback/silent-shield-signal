-- Create table for AI assistant chat messages
CREATE TABLE IF NOT EXISTS public.ai_assistant_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.ai_assistant_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_assistant_messages' AND policyname = 'Users can view their own AI messages') THEN
    CREATE POLICY "Users can view their own AI messages"
    ON public.ai_assistant_messages
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- Policy: Users can insert their own messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_assistant_messages' AND policyname = 'Users can insert their own AI messages') THEN
    CREATE POLICY "Users can insert their own AI messages"
    ON public.ai_assistant_messages
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Policy: Users can delete their own messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_assistant_messages' AND policyname = 'Users can delete their own AI messages') THEN
    CREATE POLICY "Users can delete their own AI messages"
    ON public.ai_assistant_messages
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_user_id_created_at
ON public.ai_assistant_messages(user_id, created_at);

-- Add trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_assistant_messages_updated_at') THEN
    CREATE TRIGGER update_ai_assistant_messages_updated_at
    BEFORE UPDATE ON public.ai_assistant_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
