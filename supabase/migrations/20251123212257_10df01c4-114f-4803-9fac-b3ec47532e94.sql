-- Enable RLS on ai_assistant_messages if not already enabled
ALTER TABLE ai_assistant_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to recreate them
DROP POLICY IF EXISTS "Users can view their own messages" ON ai_assistant_messages;
DROP POLICY IF EXISTS "Users can insert their own messages" ON ai_assistant_messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON ai_assistant_messages;

-- Allow users to view their own messages (enables cross-device sync)
CREATE POLICY "Users can view their own messages"
ON ai_assistant_messages
FOR SELECT
USING (auth.uid() = user_id);

-- Allow users to insert their own messages
CREATE POLICY "Users can insert their own messages"
ON ai_assistant_messages
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Allow users to delete their own messages
CREATE POLICY "Users can delete their own messages"
ON ai_assistant_messages
FOR DELETE
USING (auth.uid() = user_id);