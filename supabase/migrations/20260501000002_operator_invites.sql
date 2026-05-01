-- One-time operator invites for the AEGIS Mobile day-one onboarding
-- flow. An existing operator generates an invite (QR / 6-digit PIN /
-- email magic link) scoped to:
--   - a specific conversation (auto-joined on signup), and/or
--   - a specific client (creates a client_users mapping), and/or
--   - a specific role (creates a user_roles entry)
-- The invitee redeems the token via the public /invite/:tokenOrPin
-- route on the mobile app, signs up, and is dropped into the right
-- conversation with the right scope. Tokens expire in 15 min and are
-- single-use.

CREATE TABLE IF NOT EXISTS public.operator_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Long-form token for QR + email magic link
  token           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- 6-character PIN (letters + numbers, uppercase) for verbal / typed
  -- entry when QR scanning is impractical
  pin             TEXT NOT NULL UNIQUE
                  CHECK (pin ~ '^[A-Z0-9]{6}$'),
  -- Scopes
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  role            public.app_role,
  -- Optional pre-fill — only set when this is an emailed invite
  email           TEXT,
  -- Audit
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '15 minutes',
  used_at         TIMESTAMPTZ,
  used_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_invites_token   ON public.operator_invites (token);
CREATE INDEX IF NOT EXISTS idx_operator_invites_pin     ON public.operator_invites (pin);
CREATE INDEX IF NOT EXISTS idx_operator_invites_active  ON public.operator_invites (expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.operator_invites ENABLE ROW LEVEL SECURITY;

-- RLS: only the creator (and admins) can see their own invites. The
-- accept-invite edge function bypasses RLS via the service role.
DROP POLICY IF EXISTS "Operator sees own invites" ON public.operator_invites;
CREATE POLICY "Operator sees own invites" ON public.operator_invites
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Operators create invites" ON public.operator_invites;
CREATE POLICY "Operators create invites" ON public.operator_invites
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Future-feature scaffold: optional location capture on signup so a
-- map view can show where each operator came online from. Stored on
-- profiles (one row per operator) rather than per-event so privacy is
-- a single toggle. Lat/lng nullable; null = operator did not grant
-- location permission.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_known_lat       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_loc_at    TIMESTAMPTZ;
