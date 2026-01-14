-- User Preferences (Global - applies across all clients)
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  communication_style TEXT, -- e.g., 'concise', 'detailed', 'technical'
  preferred_format TEXT, -- e.g., 'bullet_points', 'paragraphs', 'structured'
  role_context TEXT, -- e.g., 'security analyst', 'project manager'
  timezone TEXT,
  language_preference TEXT DEFAULT 'en',
  custom_preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Project Context (Client-specific)
CREATE TABLE public.user_project_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  project_description TEXT,
  current_status TEXT, -- e.g., 'active', 'on_hold', 'completed'
  key_details JSONB DEFAULT '{}', -- important facts, deadlines, stakeholders
  priority TEXT DEFAULT 'medium',
  last_mentioned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Conversation Summaries (Client-scoped or Global)
CREATE TABLE public.conversation_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE, -- NULL = global memory
  memory_type TEXT NOT NULL, -- 'summary', 'key_fact', 'preference', 'decision'
  content TEXT NOT NULL,
  context_tags TEXT[] DEFAULT '{}',
  importance_score INTEGER DEFAULT 5, -- 1-10 scale
  expires_at TIMESTAMP WITH TIME ZONE, -- optional expiry for temporary context
  source_conversation_id UUID, -- link to original conversation if applicable
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Memory Access Log (for analytics and relevance scoring)
CREATE TABLE public.memory_access_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_id UUID REFERENCES public.conversation_memory(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.user_project_context(id) ON DELETE CASCADE,
  accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  was_useful BOOLEAN -- user feedback on memory relevance
);

-- Enable RLS on all tables
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_access_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own memory data
CREATE POLICY "Users can view own preferences" ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON public.user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own project context" ON public.user_project_context
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own project context" ON public.user_project_context
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own conversation memory" ON public.conversation_memory
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own conversation memory" ON public.conversation_memory
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own memory access log" ON public.memory_access_log
  FOR ALL USING (auth.uid() = user_id);

-- Indexes for efficient retrieval
CREATE INDEX idx_user_preferences_user_id ON public.user_preferences(user_id);
CREATE INDEX idx_user_project_context_user_client ON public.user_project_context(user_id, client_id);
CREATE INDEX idx_user_project_context_last_mentioned ON public.user_project_context(user_id, last_mentioned_at DESC);
CREATE INDEX idx_conversation_memory_user_client ON public.conversation_memory(user_id, client_id);
CREATE INDEX idx_conversation_memory_importance ON public.conversation_memory(user_id, importance_score DESC);
CREATE INDEX idx_conversation_memory_type ON public.conversation_memory(user_id, memory_type);

-- Trigger for updated_at
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_project_context_updated_at
  BEFORE UPDATE ON public.user_project_context
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_conversation_memory_updated_at
  BEFORE UPDATE ON public.conversation_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();