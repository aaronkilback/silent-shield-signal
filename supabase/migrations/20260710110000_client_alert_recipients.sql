-- #71 A (Step-3) — client_alert_recipients: the explicit, operator-curated allowlist of
-- who may receive real alert emails per client. Delivery (#71 B) claims ONLY alerts whose
-- recipient is an ACTIVE + VERIFIED row here. NEVER derived from existing contact fields
-- (the `.example` placeholder problem) — operator-populated at onboarding.
--
-- Provenance doctrine: client-owned (client_id NOT NULL, FK). RLS fail-closed.
CREATE TABLE IF NOT EXISTS public.client_alert_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text,                          -- informational: 'primary' | 'security' | 'ops' | ...
  active       boolean NOT NULL DEFAULT false,
  verified_at  timestamptz,                   -- a confirmed test receipt to this inbox, recorded
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,                          -- actor/audit (operator), separate from ownership
  -- HARD RULE: cannot be active without a recorded verification.
  CONSTRAINT car_verified_before_active CHECK (active = false OR verified_at IS NOT NULL),
  CONSTRAINT car_email_nonempty          CHECK (length(btrim(email)) > 0)
);

-- One row per (client, email), case-insensitive (matches claim's lower(email)=lower(recipient)).
CREATE UNIQUE INDEX IF NOT EXISTS client_alert_recipients_client_email_ci
  ON public.client_alert_recipients (client_id, lower(email));

-- Claim-path lookup index: (client_id, lower(email)) WHERE active+verified.
CREATE INDEX IF NOT EXISTS client_alert_recipients_active_lookup
  ON public.client_alert_recipients (client_id, lower(email))
  WHERE active = true AND verified_at IS NOT NULL;

-- RLS: fail-closed. Operator/super_admin manage; the claim RPC is SECURITY DEFINER so it reads
-- regardless of RLS. No anon/authenticated broad access (least privilege).
ALTER TABLE public.client_alert_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS car_super_admin_all ON public.client_alert_recipients;
CREATE POLICY car_super_admin_all ON public.client_alert_recipients
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- keep updated_at honest
CREATE OR REPLACE FUNCTION public.tg_client_alert_recipients_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_car_touch ON public.client_alert_recipients;
CREATE TRIGGER trg_car_touch BEFORE UPDATE ON public.client_alert_recipients
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_alert_recipients_touch();
