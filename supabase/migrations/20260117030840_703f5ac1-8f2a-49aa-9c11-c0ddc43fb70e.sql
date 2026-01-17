-- =====================================================
-- CHAT EXPERIENCE ENHANCEMENTS
-- =====================================================

-- Add title and archived status to conversations
ALTER TABLE public.ai_assistant_messages 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_memory_extracted BOOLEAN DEFAULT FALSE;

-- Create conversation summaries table for archived conversations
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_facts JSONB DEFAULT '[]'::jsonb,
  message_count INTEGER DEFAULT 0,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

-- RLS policies for conversation_summaries
CREATE POLICY "Users can view own summaries" ON public.conversation_summaries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view tenant shared summaries" ON public.conversation_summaries
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create own summaries" ON public.conversation_summaries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own summaries" ON public.conversation_summaries
  FOR UPDATE USING (auth.uid() = user_id);

-- =====================================================
-- TENANT ISOLATION FOR CORE TABLES
-- =====================================================

-- Add tenant_id to signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_signals_tenant_id ON public.signals(tenant_id);

-- Add tenant_id to incidents
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON public.incidents(tenant_id);

-- Add tenant_id to entities
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_entities_tenant_id ON public.entities(tenant_id);

-- Add tenant_id to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON public.clients(tenant_id);

-- =====================================================
-- TENANT ACTIVITY FEED
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tenant_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  resource_name TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tenant_activity ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view activity for their tenants
CREATE POLICY "Users can view tenant activity" ON public.tenant_activity
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- RLS policy: System can insert activity
CREATE POLICY "System can insert activity" ON public.tenant_activity
  FOR INSERT WITH CHECK (true);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_tenant_activity_tenant_created ON public.tenant_activity(tenant_id, created_at DESC);

-- Enable realtime for activity feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_activity;

-- =====================================================
-- SESSION MANAGEMENT
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),
  user_agent TEXT,
  ip_address TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own sessions" ON public.user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON public.user_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON public.user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Index for session management
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON public.user_sessions(user_id, is_active, last_active_at DESC);

-- =====================================================
-- KEYBOARD SHORTCUTS PREFERENCES
-- =====================================================

-- Add keyboard shortcuts to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS keyboard_shortcuts JSONB DEFAULT '{"enabled": true, "search": "cmd+k", "newChat": "cmd+n"}'::jsonb;

-- =====================================================
-- UPDATE TRIGGERS
-- =====================================================

-- Trigger for conversation_summaries updated_at
CREATE OR REPLACE TRIGGER update_conversation_summaries_updated_at
  BEFORE UPDATE ON public.conversation_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();