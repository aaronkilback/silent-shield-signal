-- Authoritative Client Membership Substrate v1
--
-- This migration creates the authority primitive only. It intentionally does
-- not change RLS on signals, incidents, entities, reports, briefings, agent
-- tables, realtime, or service-role Edge Function read paths.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_id_tenant_id_key'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_id_tenant_id_key UNIQUE (id, tenant_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin', 'owner')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revocation_reason text,
  CONSTRAINT client_memberships_client_tenant_fkey
    FOREIGN KEY (client_id, tenant_id)
    REFERENCES public.clients(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_memberships_revocation_state_check CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    OR
    (status <> 'revoked' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS client_memberships_one_active_per_user_client
  ON public.client_memberships (user_id, client_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_client_memberships_user_status
  ON public.client_memberships (user_id, status);

CREATE INDEX IF NOT EXISTS idx_client_memberships_client_status
  ON public.client_memberships (client_id, status);

ALTER TABLE public.client_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_memberships FROM anon;
REVOKE ALL ON public.client_memberships FROM authenticated;
GRANT SELECT ON public.client_memberships TO authenticated;

DROP POLICY IF EXISTS "client_memberships_read_own_active" ON public.client_memberships;
CREATE POLICY "client_memberships_read_own_active"
  ON public.client_memberships
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND status = 'active'
  );

CREATE OR REPLACE FUNCTION public.client_memberships_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'client_memberships immutable fields cannot be changed';
    END IF;

    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_memberships_guard_immutable_trg ON public.client_memberships;
CREATE TRIGGER client_memberships_guard_immutable_trg
  BEFORE UPDATE ON public.client_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.client_memberships_guard_immutable();

CREATE OR REPLACE FUNCTION public.has_active_client_membership(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_memberships cm
    WHERE cm.user_id = auth.uid()
      AND cm.client_id = _client_id
      AND cm.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_client_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_client_membership(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_active_client_membership(uuid) IS
  'Future RLS helper. Uses auth.uid() and public.client_memberships only. '
  'Does not accept browser-supplied user identity and does not consult profiles.client_id.';

CREATE OR REPLACE FUNCTION public.manage_client_membership(
  _action text,
  _membership_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _role text DEFAULT NULL,
  _status text DEFAULT NULL,
  _revocation_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_membership_id uuid;
  v_role text;
  v_status text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'client membership management requires super_admin';
  END IF;

  IF _action = 'create' THEN
    IF _user_id IS NULL OR _tenant_id IS NULL OR _client_id IS NULL THEN
      RAISE EXCEPTION 'create requires user_id, tenant_id, and client_id';
    END IF;

    v_role := COALESCE(_role, 'viewer');
    v_status := COALESCE(_status, 'pending');

    IF v_role NOT IN ('viewer', 'analyst', 'admin', 'owner') THEN
      RAISE EXCEPTION 'invalid client membership role';
    END IF;
    IF v_status NOT IN ('pending', 'active') THEN
      RAISE EXCEPTION 'create may only create pending or active memberships';
    END IF;

    INSERT INTO public.client_memberships (
      user_id,
      tenant_id,
      client_id,
      role,
      status,
      created_by,
      updated_by
    )
    VALUES (
      _user_id,
      _tenant_id,
      _client_id,
      v_role,
      v_status,
      v_actor,
      v_actor
    )
    RETURNING id INTO v_membership_id;

    RETURN v_membership_id;
  ELSIF _action = 'set_role' THEN
    IF _membership_id IS NULL OR _role IS NULL THEN
      RAISE EXCEPTION 'set_role requires membership_id and role';
    END IF;
    IF _role NOT IN ('viewer', 'analyst', 'admin', 'owner') THEN
      RAISE EXCEPTION 'invalid client membership role';
    END IF;

    UPDATE public.client_memberships
    SET role = _role
    WHERE id = _membership_id
      AND status IN ('pending', 'active')
    RETURNING id INTO v_membership_id;

    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'membership not found or not mutable';
    END IF;

    RETURN v_membership_id;
  ELSIF _action = 'activate' THEN
    IF _membership_id IS NULL THEN
      RAISE EXCEPTION 'activate requires membership_id';
    END IF;

    UPDATE public.client_memberships
    SET status = 'active'
    WHERE id = _membership_id
      AND status = 'pending'
    RETURNING id INTO v_membership_id;

    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'membership not found or not pending';
    END IF;

    RETURN v_membership_id;
  ELSIF _action = 'revoke' THEN
    IF _membership_id IS NULL THEN
      RAISE EXCEPTION 'revoke requires membership_id';
    END IF;

    UPDATE public.client_memberships
    SET
      status = 'revoked',
      revoked_at = now(),
      revoked_by = v_actor,
      revocation_reason = NULLIF(BTRIM(_revocation_reason), '')
    WHERE id = _membership_id
      AND status IN ('pending', 'active')
    RETURNING id INTO v_membership_id;

    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'membership not found or already revoked';
    END IF;

    RETURN v_membership_id;
  ELSE
    RAISE EXCEPTION 'unsupported client membership action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_client_membership(text, uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_client_membership(text, uuid, uuid, uuid, uuid, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.manage_client_membership(text, uuid, uuid, uuid, uuid, text, text, text) IS
  'Protected v1 membership-management RPC. Requires server-derived super_admin '
  'via auth.uid(); sets audit fields server-side; does not use profiles.client_id.';

