-- Drop existing policies
DROP POLICY IF EXISTS "Users can manage their own conversations" ON agent_conversations;
DROP POLICY IF EXISTS "Users can manage messages in their conversations" ON agent_messages;

-- Create separate policies for agent_conversations
CREATE POLICY "Users can view their own conversations" 
ON agent_conversations FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations" 
ON agent_conversations FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" 
ON agent_conversations FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" 
ON agent_conversations FOR DELETE 
USING (auth.uid() = user_id);

-- Create separate policies for agent_messages
CREATE POLICY "Users can view messages in their conversations" 
ON agent_messages FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM agent_conversations 
  WHERE agent_conversations.id = agent_messages.conversation_id 
  AND agent_conversations.user_id = auth.uid()
));

CREATE POLICY "Users can create messages in their conversations" 
ON agent_messages FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM agent_conversations 
  WHERE agent_conversations.id = agent_messages.conversation_id 
  AND agent_conversations.user_id = auth.uid()
));

CREATE POLICY "Users can delete messages in their conversations" 
ON agent_messages FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM agent_conversations 
  WHERE agent_conversations.id = agent_messages.conversation_id 
  AND agent_conversations.user_id = auth.uid()
));