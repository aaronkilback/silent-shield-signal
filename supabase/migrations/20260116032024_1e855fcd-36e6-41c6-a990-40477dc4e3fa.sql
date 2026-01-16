
-- Create briefing chat messages table
CREATE TABLE public.briefing_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id),
  author_agent_id UUID REFERENCES public.ai_agents(id),
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'message', -- 'message', 'agent_response', 'system'
  mentioned_agent_ids UUID[] DEFAULT '{}',
  is_group_question BOOLEAN DEFAULT false,
  parent_message_id UUID REFERENCES public.briefing_chat_messages(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.briefing_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies based on workspace membership
CREATE POLICY "Workspace members can view briefing chat" 
ON public.briefing_chat_messages 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM briefing_sessions bs
    JOIN workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_id AND wm.user_id = auth.uid()
  )
);

CREATE POLICY "Workspace members can insert briefing chat" 
ON public.briefing_chat_messages 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM briefing_sessions bs
    JOIN workspace_members wm ON wm.workspace_id = bs.workspace_id
    WHERE bs.id = briefing_id AND wm.user_id = auth.uid()
  )
);

-- Create indexes
CREATE INDEX idx_briefing_chat_messages_briefing_id ON public.briefing_chat_messages(briefing_id);
CREATE INDEX idx_briefing_chat_messages_created_at ON public.briefing_chat_messages(created_at);

-- Enable realtime for chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.briefing_chat_messages;
