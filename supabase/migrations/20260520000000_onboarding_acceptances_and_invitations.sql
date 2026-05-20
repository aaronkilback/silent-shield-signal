-- Task B Block 1: first-login onboarding infrastructure
-- Adds three tables to support invite-link onboarding + versioned acceptance audit:
--   1. tenant_invitations          — admin-issued single-use tokens
--   2. onboarding_acceptances      — immutable per-user accept events
--   3. onboarding_required_versions — single-row source of truth for current required versions

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tenant_invitations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email        text NOT NULL,
  -- tenant-level role (matches tenant_users.role enum)
  role         public.tenant_role NOT NULL DEFAULT 'analyst',
  -- global app role assigned to the new user_roles row on accept
  app_role     public.app_role NOT NULL DEFAULT 'analyst',
  token        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at  timestamptz,
  accepted_by  uuid,
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked'))
);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON public.tenant_invitations(token);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON public.tenant_invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_status ON public.tenant_invitations(tenant_id, status);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- Tenant admins can manage invites for their own tenant; super_admin sees all.
CREATE POLICY ti_admin_manage ON public.tenant_invitations FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin'::public.app_role)
        AND tenant_id IN (
          SELECT tu.tenant_id FROM public.tenant_users tu
          WHERE tu.user_id = auth.uid() AND tu.role IN ('admin','owner')
        ))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin'::public.app_role)
        AND tenant_id IN (
          SELECT tu.tenant_id FROM public.tenant_users tu
          WHERE tu.user_id = auth.uid() AND tu.role IN ('admin','owner')
        ))
  );

-- Invitee can read their own pending invite (matched by email on the JWT).
-- Used by the /accept-tenant-invite peek path.
CREATE POLICY ti_self_email_peek ON public.tenant_invitations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND lower(email) = lower((auth.jwt() ->> 'email'))
    AND status = 'pending'
    AND expires_at > now()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. onboarding_acceptances (immutable audit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_acceptances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  ip                text,
  user_agent        text,
  terms_version     text NOT NULL,
  ai_ack_version    text NOT NULL,
  privacy_version   text NOT NULL,
  source            text NOT NULL DEFAULT 'first_login'
                    CHECK (source IN ('first_login','reaccept','admin_force'))
);
CREATE INDEX IF NOT EXISTS idx_onb_user_tenant_recent
  ON public.onboarding_acceptances(user_id, tenant_id, accepted_at DESC);

ALTER TABLE public.onboarding_acceptances ENABLE ROW LEVEL SECURITY;

-- Users read their own acceptances; tenant admins read all in their tenant; super_admin sees all.
CREATE POLICY onb_self_or_admin_read ON public.onboarding_acceptances FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin'::public.app_role)
        AND tenant_id IN (
          SELECT tenant_id FROM public.tenant_users
          WHERE user_id = auth.uid() AND role IN ('admin','owner')
        ))
  );

-- Users insert their own acceptances; service_role bypasses RLS for admin_force backfills.
CREATE POLICY onb_self_insert ON public.onboarding_acceptances FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- No UPDATE/DELETE policies — table is append-only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. onboarding_required_versions (single-row config; super_admin writes, all read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_required_versions (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  terms_version     text NOT NULL,
  ai_ack_version    text NOT NULL,
  privacy_version   text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

-- Seed initial v1.0-pre-counsel-review for all three sections.
INSERT INTO public.onboarding_required_versions
  (id, terms_version, ai_ack_version, privacy_version)
VALUES
  (true, '1.0-pre-counsel-review', '1.0-pre-counsel-review', '1.0-pre-counsel-review')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.onboarding_required_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY req_ver_read_all_auth ON public.onboarding_required_versions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY req_ver_super_admin_write ON public.onboarding_required_versions FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper view: a user's latest acceptance vs current required versions.
--    Frontend uses this to decide whether to render the FirstLoginAgreementGate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_user_acceptance_status
WITH (security_invoker = true)
AS
SELECT
  tu.user_id,
  tu.tenant_id,
  req.terms_version    AS required_terms_version,
  req.ai_ack_version   AS required_ai_ack_version,
  req.privacy_version  AS required_privacy_version,
  latest.terms_version    AS accepted_terms_version,
  latest.ai_ack_version   AS accepted_ai_ack_version,
  latest.privacy_version  AS accepted_privacy_version,
  latest.accepted_at,
  (latest.id IS NOT NULL
    AND latest.terms_version   = req.terms_version
    AND latest.ai_ack_version  = req.ai_ack_version
    AND latest.privacy_version = req.privacy_version
  ) AS up_to_date
FROM public.tenant_users tu
CROSS JOIN public.onboarding_required_versions req
LEFT JOIN LATERAL (
  SELECT id, terms_version, ai_ack_version, privacy_version, accepted_at
  FROM public.onboarding_acceptances oa
  WHERE oa.user_id = tu.user_id AND oa.tenant_id = tu.tenant_id
  ORDER BY accepted_at DESC
  LIMIT 1
) latest ON true;

-- Grant read on the view to authenticated; RLS on underlying tables still applies.
GRANT SELECT ON public.v_user_acceptance_status TO authenticated;

COMMENT ON TABLE public.tenant_invitations IS
  'Single-use tenant invitations issued by tenant admins. Email-based, expiring (72h default). Replaces emailed-password onboarding.';
COMMENT ON TABLE public.onboarding_acceptances IS
  'Immutable append-only log of user acceptances of Terms/AI/Privacy. Version-tracked; counsel revisions force re-acceptance.';
COMMENT ON TABLE public.onboarding_required_versions IS
  'Single-row source of truth for currently-required versions. Bump on counsel revision to force re-accept across all users.';
