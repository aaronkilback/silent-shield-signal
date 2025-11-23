-- CRITICAL: DO NOT DROP OR MODIFY ai_assistant_messages TABLE
-- This table contains user AI conversation history and must be preserved

-- Add soft delete column
ALTER TABLE ai_assistant_messages 
ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone DEFAULT NULL;

-- Create index for faster queries on non-deleted messages
CREATE INDEX IF NOT EXISTS idx_ai_messages_not_deleted 
ON ai_assistant_messages(user_id, created_at) 
WHERE deleted_at IS NULL;

-- Update RLS policies to exclude soft-deleted messages
DROP POLICY IF EXISTS "Users can view their own AI messages" ON ai_assistant_messages;
CREATE POLICY "Users can view their own AI messages"
ON ai_assistant_messages
FOR SELECT
USING (auth.uid() = user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can delete their own AI messages" ON ai_assistant_messages;
CREATE POLICY "Users can soft delete their own AI messages"
ON ai_assistant_messages
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add comment to table as migration warning
COMMENT ON TABLE ai_assistant_messages IS 'CRITICAL: Contains user AI conversation history. Use soft deletes only (deleted_at). Never drop or truncate this table.';

-- Create function to restore soft-deleted messages (admin only)
CREATE OR REPLACE FUNCTION restore_ai_messages(message_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can restore messages';
  END IF;
  
  UPDATE ai_assistant_messages
  SET deleted_at = NULL
  WHERE id = ANY(message_ids);
END;
$$;