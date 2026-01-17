-- Create table for pending agent messages
CREATE TABLE public.agent_pending_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  trigger_event TEXT NOT NULL DEFAULT 'first_login',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- Create table for user agent preferences (mute/disconnect)
CREATE TABLE public.user_agent_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  proactive_enabled BOOLEAN NOT NULL DEFAULT true,
  muted_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id)
);

-- Enable RLS
ALTER TABLE public.agent_pending_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_agent_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies for pending messages
CREATE POLICY "Users can view their own pending messages"
ON public.agent_pending_messages
FOR SELECT
USING (auth.uid() = recipient_user_id);

CREATE POLICY "Users can update their own pending messages"
ON public.agent_pending_messages
FOR UPDATE
USING (auth.uid() = recipient_user_id);

CREATE POLICY "Authenticated users can create pending messages"
ON public.agent_pending_messages
FOR INSERT
WITH CHECK (auth.uid() = sender_user_id);

-- RLS policies for user preferences
CREATE POLICY "Users can manage their own preferences"
ON public.user_agent_preferences
FOR ALL
USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_pending_messages_recipient ON public.agent_pending_messages(recipient_user_id, delivered_at);
CREATE INDEX idx_user_agent_preferences_user ON public.user_agent_preferences(user_id);