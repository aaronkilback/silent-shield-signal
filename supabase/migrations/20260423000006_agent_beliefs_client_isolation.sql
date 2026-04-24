-- Agent beliefs client isolation
--
-- Adds client_id to agent_beliefs so specialist intelligence derived from
-- one client's signals cannot bleed into another client's operational context.
--
-- Design:
--   client_id IS NULL  → platform-wide / cross-client belief (safe to surface to all)
--   client_id = X      → derived from client-specific signal data; only shown in X context
--
-- Existing beliefs are left with client_id = NULL (they are cross-client aggregations).

ALTER TABLE public.agent_beliefs
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

-- Speed index for the two common read patterns:
--   1. agent-chat: WHERE agent_call_sign = ? AND (client_id IS NULL OR client_id = ?)
--   2. dashboard:  WHERE is_active = true AND (client_id IS NULL OR client_id = ANY(?))
CREATE INDEX IF NOT EXISTS idx_agent_beliefs_client
  ON public.agent_beliefs (client_id, is_active, agent_call_sign);
