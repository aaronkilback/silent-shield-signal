-- Allow AEGIS Mobile messages to come from either a human operator or
-- an AI agent. Tier-1 chat-mention flow needs the agent's response to
-- live in the same `messages` table as the rest of the conversation
-- so threading, ordering, and realtime are unified.
--
-- Before: messages.sender_id UUID NOT NULL REFERENCES auth.users.
-- After:
--   • sender_id is nullable
--   • new column agent_id REFERENCES ai_agents(id)
--   • CHECK constraint enforces exactly one of (sender_id, agent_id)
--   • new column is_agent_query BOOLEAN — true on operator messages
--     that triggered an agent (these were sent plaintext so the agent
--     could read them; the UI surfaces this so operators know)

ALTER TABLE public.messages
  ALTER COLUMN sender_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_agent_query BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentioned_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;

-- Backfill: every existing row was a human message
-- (no-op on prod — table is fresh — but safe for replays)
UPDATE public.messages SET sender_id = sender_id WHERE agent_id IS NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_sender_xor_agent;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_xor_agent
  CHECK (
    (sender_id IS NOT NULL AND agent_id IS NULL)
    OR (sender_id IS NULL AND agent_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON public.messages (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_mentioned_agent ON public.messages (mentioned_agent_id) WHERE mentioned_agent_id IS NOT NULL;

-- Update the INSERT policy: a message must come from auth.uid() (human)
-- OR be inserted by the service role (agent response, via edge function).
-- Agent inserts bypass RLS by design.
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );
