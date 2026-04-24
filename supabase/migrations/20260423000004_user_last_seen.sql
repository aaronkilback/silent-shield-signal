-- Tracks the previous session time per user so we can generate
-- "since you last logged in" summaries. last_sign_in_at on auth.users
-- updates on every token refresh and is unreliable for this purpose.

CREATE TABLE IF NOT EXISTS public.user_last_seen (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  previous_seen_at timestamptz  -- the session before this one — used to compute the gap
);

ALTER TABLE public.user_last_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to user_last_seen"
  ON public.user_last_seen FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can read own last_seen"
  ON public.user_last_seen FOR SELECT TO authenticated
  USING (user_id = auth.uid());
