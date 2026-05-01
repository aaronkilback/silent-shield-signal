-- AEGIS Mobile messaging schema, ported from the deceased mobile-only
-- Supabase project (odvvexosqawixehvfzed) onto Fortress so the mobile
-- PWA can use Fortress accounts end-to-end.
--
-- Adds:
--   • conversations            — direct/group operator chats
--   • conversation_participants — junction
--   • messages                  — per-conversation messages with E2E
--                                 fields (encrypted, nonce) and a JSONB
--                                 attachments column
--   • broadcasts                — admin-to-team announcements
--   • mute_preferences          — per-user notification mute schedule
-- Adds to existing tables:
--   • profiles.public_key       — recipient pubkey for E2E (libsodium X25519)
--   • profiles.key_salt         — Argon2id salt for derive-from-password keys
-- Plus helper functions and RLS policies wired against Fortress's
-- existing app_role enum (admin / super_admin / analyst / viewer).

-- ─────────────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  is_group    BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv
  ON public.conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON public.conversation_participants (user_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  -- E2E (libsodium X25519 + XSalsa20-Poly1305). For 1:1 conversations
  -- content is base64 ciphertext and nonce is the per-message nonce.
  -- For groups content is a JSON envelope:
  --   {"v":1,"e":{"<user_id>":{"c":"<base64>","n":"<base64>"}}}
  -- and nonce is null. See ConversationView.tsx in the mobile repo.
  encrypted       BOOLEAN NOT NULL DEFAULT false,
  nonce           TEXT,
  attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON public.messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mute_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  days_of_week  INTEGER[] NOT NULL DEFAULT '{}', -- 0=Sun..6=Sat
  start_time    TIME,
  end_time      TIME,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encryption fields on the existing profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_key TEXT,
  ADD COLUMN IF NOT EXISTS key_salt   TEXT;

-- ─────────────────────────────────────────────────────────────────────
-- Helper functions
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_conversation_participant(
  _conversation_id UUID, _user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_muted(_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mute_preferences
    WHERE user_id = _user_id
      AND enabled = true
      AND EXTRACT(DOW FROM now()) = ANY(days_of_week)
      AND (
        (start_time IS NULL AND end_time IS NULL)
        OR (CURRENT_TIME BETWEEN start_time AND end_time)
      )
  )
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mute_preferences           ENABLE ROW LEVEL SECURITY;

-- conversations
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_participant(id, auth.uid()));

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations" ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_conversation_participant(id, auth.uid()));

-- conversation_participants
DROP POLICY IF EXISTS "Participants can view members" ON public.conversation_participants;
CREATE POLICY "Participants can view members" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()));

-- A user can add themselves OR add others to a conversation they're already in.
-- This unblocks the "add operator" flow without exposing arbitrary inserts.
DROP POLICY IF EXISTS "Users can join or add to their conversations" ON public.conversation_participants;
CREATE POLICY "Users can join or add to their conversations" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_conversation_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can leave conversations" ON public.conversation_participants;
CREATE POLICY "Users can leave conversations" ON public.conversation_participants
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- messages
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
CREATE POLICY "Participants can view messages" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );

-- broadcasts
DROP POLICY IF EXISTS "Users see broadcasts when not muted" ON public.broadcasts;
CREATE POLICY "Users see broadcasts when not muted" ON public.broadcasts
  FOR SELECT TO authenticated USING (NOT public.is_muted(auth.uid()));

DROP POLICY IF EXISTS "Admins create broadcasts" ON public.broadcasts;
CREATE POLICY "Admins create broadcasts" ON public.broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- mute_preferences (own row only)
DROP POLICY IF EXISTS "Users manage own mute prefs" ON public.mute_preferences;
CREATE POLICY "Users manage own mute prefs" ON public.mute_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;

-- ─────────────────────────────────────────────────────────────────────
-- Storage bucket for message attachments
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload attachments" ON storage.objects;
CREATE POLICY "Authenticated users can upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "Public read access to attachments" ON storage.objects;
CREATE POLICY "Public read access to attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "Users can delete own attachments" ON storage.objects;
CREATE POLICY "Users can delete own attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─────────────────────────────────────────────────────────────────────
-- RPC: create_conversation_with_participant
-- Mobile NewConversationDialog calls this. It inserts a conversation
-- and adds the calling auth.uid() as the first participant in one
-- round-trip, so the client doesn't need INSERT privileges that span
-- both tables before the row is reachable.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_conversation_with_participant(
  _name TEXT, _is_group BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  INSERT INTO public.conversations (name, is_group, created_by)
  VALUES (_name, COALESCE(_is_group, false), auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_id, auth.uid());

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_conversation_with_participant(TEXT, BOOLEAN) TO authenticated;
