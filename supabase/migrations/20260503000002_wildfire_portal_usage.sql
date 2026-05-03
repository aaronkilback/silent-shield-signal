-- Public Wildfire Portal usage telemetry. Logged by the /wildfire route
-- and the wildfire-portal-chat edge function so we can see who's
-- using it, what they're asking, and which tools the agent fires.
-- Service-role writes only (RLS denies anon access).

CREATE TABLE IF NOT EXISTS public.wildfire_portal_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'page_view',          -- portal loaded
    'report_view',        -- daily report HTML rendered
    'chat_message',       -- visitor sent a chat message
    'tool_call',          -- agent invoked a tool during the chat
    'agent_response'      -- agent finalised a reply
  )),
  session_id      TEXT NOT NULL,            -- generated client-side, persisted in localStorage
  ip_hash         TEXT,                     -- SHA-256 of remote IP — counts unique visitors without storing PII
  user_agent      TEXT,
  referrer        TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wildfire_portal_usage_event   ON public.wildfire_portal_usage(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wildfire_portal_usage_session ON public.wildfire_portal_usage(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wildfire_portal_usage_created ON public.wildfire_portal_usage(created_at DESC);

ALTER TABLE public.wildfire_portal_usage ENABLE ROW LEVEL SECURITY;

-- Authenticated Fortress users (analysts) can read for the usage dashboard
CREATE POLICY "wildfire_portal_usage_authenticated_read"
  ON public.wildfire_portal_usage FOR SELECT
  USING (auth.role() = 'authenticated');

-- Public visitors INSERT via the edge function (which uses service role,
-- bypassing RLS), so no public insert policy needed. Anon SELECTs are
-- denied — visitors can't see who else is using the portal.
