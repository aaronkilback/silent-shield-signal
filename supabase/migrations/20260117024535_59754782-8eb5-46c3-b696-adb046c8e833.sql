-- Add tenant_id and visibility to conversation tables for hybrid chat visibility

-- 1. Add tenant_id and is_shared to agent_conversations
ALTER TABLE public.agent_conversations
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id),
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false;

-- 2. Add tenant_id and is_shared to ai_assistant_messages (or create a conversations wrapper)
-- Actually, ai_assistant_messages is flat - let's add a conversation grouping
ALTER TABLE public.ai_assistant_messages
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id),
ADD COLUMN IF NOT EXISTS conversation_id UUID,
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false;

-- 3. Add tenant_id to conversation_memory
ALTER TABLE public.conversation_memory
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_conversations_tenant_id ON public.agent_conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_is_shared ON public.agent_conversations(is_shared) WHERE is_shared = true;
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_tenant_id ON public.ai_assistant_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_conversation_id ON public.ai_assistant_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_tenant_id ON public.conversation_memory(tenant_id);

-- 5. RLS for agent_conversations - users see their own OR shared within tenant
DROP POLICY IF EXISTS "Users can view own or shared tenant conversations" ON public.agent_conversations;
CREATE POLICY "Users can view own or shared tenant conversations"
ON public.agent_conversations FOR SELECT
USING (
  user_id = auth.uid() 
  OR (is_shared = true AND tenant_id IS NOT NULL AND is_tenant_member(tenant_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can create own conversations" ON public.agent_conversations;
CREATE POLICY "Users can create own conversations"
ON public.agent_conversations FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own conversations" ON public.agent_conversations;
CREATE POLICY "Users can update own conversations"
ON public.agent_conversations FOR UPDATE
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own conversations" ON public.agent_conversations;
CREATE POLICY "Users can delete own conversations"
ON public.agent_conversations FOR DELETE
USING (user_id = auth.uid());

-- 6. RLS for ai_assistant_messages - same hybrid logic
DROP POLICY IF EXISTS "Users can view own or shared tenant messages" ON public.ai_assistant_messages;
CREATE POLICY "Users can view own or shared tenant messages"
ON public.ai_assistant_messages FOR SELECT
USING (
  user_id = auth.uid() 
  OR (is_shared = true AND tenant_id IS NOT NULL AND is_tenant_member(tenant_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can create own messages" ON public.ai_assistant_messages;
CREATE POLICY "Users can create own messages"
ON public.ai_assistant_messages FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_assistant_messages;
CREATE POLICY "Users can update own messages"
ON public.ai_assistant_messages FOR UPDATE
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own messages" ON public.ai_assistant_messages;
CREATE POLICY "Users can delete own messages"
ON public.ai_assistant_messages FOR DELETE
USING (user_id = auth.uid());

-- 7. RLS for conversation_memory
DROP POLICY IF EXISTS "Users can view own or tenant memory" ON public.conversation_memory;
CREATE POLICY "Users can view own or tenant memory"
ON public.conversation_memory FOR SELECT
USING (
  user_id = auth.uid() 
  OR (tenant_id IS NOT NULL AND is_tenant_member(tenant_id, auth.uid()))
);

DROP POLICY IF EXISTS "Users can manage own memory" ON public.conversation_memory;
CREATE POLICY "Users can manage own memory"
ON public.conversation_memory FOR ALL
USING (user_id = auth.uid());