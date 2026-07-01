\set ON_ERROR_STOP on

\echo 'client-membership-substrate: creating minimal local fixture schema'

DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA auth;
CREATE SCHEMA public;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE public_probe NOLOGIN;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, public_probe;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, public_probe;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.clients (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id),
  name text NOT NULL
);

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'super_admin'
  )
$$;

-- Existing intelligence-table sentinels. The membership substrate migration
-- must not alter their RLS or policies.
CREATE TABLE public.signals (id uuid PRIMARY KEY);
CREATE TABLE public.incidents (id uuid PRIMARY KEY);
CREATE TABLE public.entities (id uuid PRIMARY KEY);
CREATE TABLE public.reports (id uuid PRIMARY KEY);
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY signals_existing_read ON public.signals FOR SELECT TO authenticated USING (true);
CREATE POLICY incidents_existing_read ON public.incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY entities_existing_read ON public.entities FOR SELECT TO authenticated USING (true);
CREATE POLICY reports_existing_read ON public.reports FOR SELECT TO authenticated USING (true);

CREATE TEMP TABLE policy_snapshot_before AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('signals', 'incidents', 'entities', 'reports')
ORDER BY tablename, policyname;

\echo 'client-membership-substrate: applying actual migration'
\i supabase/migrations/20260701090000_client_membership_substrate_v1.sql

\echo 'client-membership-substrate: installing assertion helpers'

CREATE OR REPLACE FUNCTION public.cm_assert(_condition boolean, _message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(_condition, false) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', _message;
  END IF;
  RAISE NOTICE 'ok: %', _message;
END;
$$;

CREATE OR REPLACE FUNCTION public.cm_assert_eq(_actual anyelement, _expected anyelement, _message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _actual IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %, expected %, got %', _message, _expected, _actual;
  END IF;
  RAISE NOTICE 'ok: %', _message;
END;
$$;

CREATE OR REPLACE FUNCTION public.cm_assert_raises(_sql text, _message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE _sql;
  RAISE EXCEPTION 'ASSERTION FAILED: %, expected SQL error but statement succeeded', _message;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION FAILED:%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'ok: % [% %]', _message, SQLSTATE, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.cm_assert_raises_state(_sql text, _expected_state text, _message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE _sql;
  RAISE EXCEPTION 'ASSERTION FAILED: %, expected SQLSTATE % but statement succeeded', _message, _expected_state;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION FAILED:%' THEN
      RAISE;
    END IF;
    IF SQLSTATE IS DISTINCT FROM _expected_state THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %, expected SQLSTATE %, got % [%]', _message, _expected_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % [% %]', _message, SQLSTATE, SQLERRM;
END;
$$;

\echo 'client-membership-substrate: loading fixtures'

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'member-a@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'member-b@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'not-super@example.invalid'),
  ('00000000-0000-0000-0000-0000000000ad', 'super-admin@example.invalid');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000ad', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000c3', 'analyst');

INSERT INTO public.tenants (id, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Tenant One'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant Two');

INSERT INTO public.clients (id, tenant_id, name) VALUES
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Client A'),
  ('12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Client B'),
  ('13000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Client C'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Client D');

\echo 'client-membership-substrate: category 1 composite client/tenant integrity'

INSERT INTO public.client_memberships (
  id, user_id, tenant_id, client_id, role, status, created_by, updated_by
) VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'analyst',
  'active',
  '00000000-0000-0000-0000-0000000000ad',
  '00000000-0000-0000-0000-0000000000ad'
);
SELECT public.cm_assert(
  EXISTS (SELECT 1 FROM public.client_memberships WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'matching client_id and tenant_id membership insert succeeds'
);
SELECT public.cm_assert_raises_state(
  $SQL$
    INSERT INTO public.client_memberships (
      user_id, tenant_id, client_id, role, status
    ) VALUES (
      '00000000-0000-0000-0000-0000000000b2',
      '20000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000001',
      'analyst',
      'active'
    )
  $SQL$,
  '23503',
  'mismatched client_id and tenant_id fails through composite foreign key'
);

\echo 'client-membership-substrate: category 2 membership lifecycle'

SELECT public.cm_assert_raises(
  $SQL$
    INSERT INTO public.client_memberships (
      user_id, tenant_id, client_id, role, status
    ) VALUES (
      '00000000-0000-0000-0000-0000000000a1',
      '10000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      'analyst',
      'active'
    )
  $SQL$,
  'duplicate active membership for user and client fails'
);
INSERT INTO public.client_memberships (
  id, user_id, tenant_id, client_id, role, status, created_by, updated_by, revoked_at, revoked_by, revocation_reason
) VALUES (
  'aaaaaaaa-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000002',
  'viewer',
  'active',
  '00000000-0000-0000-0000-0000000000ad',
  '00000000-0000-0000-0000-0000000000ad',
  null,
  null,
  null
), (
  'aaaaaaaa-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000003',
  'viewer',
  'pending',
  '00000000-0000-0000-0000-0000000000ad',
  '00000000-0000-0000-0000-0000000000ad',
  null,
  null,
  null
), (
  'aaaaaaaa-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-0000000000a1',
  '20000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000001',
  'viewer',
  'revoked',
  '00000000-0000-0000-0000-0000000000ad',
  '00000000-0000-0000-0000-0000000000ad',
  now(),
  '00000000-0000-0000-0000-0000000000ad',
  'fixture revoked'
);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM public.client_memberships WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND status = 'active'),
  2,
  'one user can hold two explicit active memberships for two different clients'
);

\echo 'client-membership-substrate: category 3 write prevention'

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT public.cm_assert_raises(
  $SQL$ INSERT INTO public.client_memberships (user_id, tenant_id, client_id, role, status) VALUES ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','viewer','pending') $SQL$,
  'anon cannot insert memberships'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET status = 'active' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003' $SQL$,
  'anon cannot update memberships'
);
SELECT public.cm_assert_raises(
  $SQL$ DELETE FROM public.client_memberships WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'anon cannot delete memberships'
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT public.cm_assert_raises(
  $SQL$ INSERT INTO public.client_memberships (user_id, tenant_id, client_id, role, status) VALUES ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','viewer','pending') $SQL$,
  'authenticated cannot self-insert memberships'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET status = 'active' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003' $SQL$,
  'authenticated cannot self-activate memberships'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET status = 'revoked' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'authenticated cannot self-revoke memberships'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET role = 'owner' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'authenticated cannot change membership role'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET client_id = '13000000-0000-0000-0000-000000000003' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'authenticated cannot change client assignment'
);
SELECT public.cm_assert_raises(
  $SQL$ DELETE FROM public.client_memberships WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'authenticated cannot delete memberships'
);
RESET ROLE;

SET ROLE public_probe;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT public.cm_assert_raises(
  $SQL$ INSERT INTO public.client_memberships (user_id, tenant_id, client_id, role, status) VALUES ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','viewer','pending') $SQL$,
  'PUBLIC cannot directly write memberships'
);
RESET ROLE;

\echo 'client-membership-substrate: category 4 read restriction'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM public.client_memberships),
  2,
  'authenticated user reads only own active memberships'
);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM public.client_memberships WHERE status <> 'active'),
  0,
  'pending and revoked rows are not visible to authenticated member'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM public.client_memberships),
  0,
  'another user cannot read member rows'
);
RESET ROLE;

\echo 'client-membership-substrate: category 5 immutable identity'

SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET id = 'bbbbbbbb-0000-0000-0000-000000000001' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct id reassignment fails'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct user reassignment fails'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET tenant_id = '20000000-0000-0000-0000-000000000002' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct tenant reassignment fails'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET client_id = '12000000-0000-0000-0000-000000000002' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct client reassignment fails'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET created_at = now() WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct created_at reassignment fails'
);
SELECT public.cm_assert_raises(
  $SQL$ UPDATE public.client_memberships SET created_by = '00000000-0000-0000-0000-0000000000b2' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' $SQL$,
  'direct created_by reassignment fails'
);

\echo 'client-membership-substrate: category 6 helper behavior'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT public.cm_assert(public.has_active_client_membership('11000000-0000-0000-0000-000000000001'), 'helper true for authenticated active member');
SELECT public.cm_assert(public.has_active_client_membership('12000000-0000-0000-0000-000000000002'), 'helper true for second explicit client membership');
SELECT public.cm_assert(NOT public.has_active_client_membership('13000000-0000-0000-0000-000000000003'), 'helper false for pending membership');
SELECT public.cm_assert(NOT public.has_active_client_membership('21000000-0000-0000-0000-000000000001'), 'helper false for revoked membership');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT public.cm_assert(NOT public.has_active_client_membership('11000000-0000-0000-0000-000000000001'), 'helper false for another user');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.cm_assert(NOT public.has_active_client_membership('11000000-0000-0000-0000-000000000001'), 'helper false for no-auth context');
SELECT public.cm_assert_raises(
  $SQL$ SELECT public.has_active_client_membership('00000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-000000000001') $SQL$,
  'no arbitrary-user helper overload exists'
);
RESET ROLE;

\echo 'client-membership-substrate: category 7 RPC authority'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
SELECT public.cm_assert_raises(
  $SQL$ SELECT public.manage_client_membership('create', NULL, '00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000003', 'viewer', 'pending', NULL) $SQL$,
  'non-super-admin cannot call membership management RPC'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
SELECT public.manage_client_membership(
  'create',
  NULL,
  '00000000-0000-0000-0000-0000000000b2',
  '10000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000003',
  'viewer',
  'pending',
  NULL
) AS created_membership_id \gset
SELECT public.cm_assert(
  :'created_membership_id' IS NOT NULL,
  'super-admin can create pending membership'
);
RESET ROLE;
SELECT public.cm_assert_eq(
  (SELECT created_by FROM public.client_memberships WHERE id = :'created_membership_id'::uuid),
  '00000000-0000-0000-0000-0000000000ad'::uuid,
  'RPC create populates created_by server-side'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
SELECT public.manage_client_membership('set_role', :'created_membership_id'::uuid, NULL, NULL, NULL, 'analyst', NULL, NULL);
RESET ROLE;
SELECT public.cm_assert_eq(
  (SELECT role FROM public.client_memberships WHERE id = :'created_membership_id'::uuid),
  'analyst',
  'super-admin can update membership role through RPC'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
SELECT public.manage_client_membership('activate', :'created_membership_id'::uuid, NULL, NULL, NULL, NULL, NULL, NULL);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT public.cm_assert(
  public.has_active_client_membership('13000000-0000-0000-0000-000000000003'),
  'activated RPC membership satisfies helper for member'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
SELECT public.manage_client_membership('revoke', :'created_membership_id'::uuid, NULL, NULL, NULL, NULL, NULL, 'behavioral test cleanup');
RESET ROLE;
SELECT public.cm_assert_eq(
  (SELECT revoked_by FROM public.client_memberships WHERE id = :'created_membership_id'::uuid),
  '00000000-0000-0000-0000-0000000000ad'::uuid,
  'RPC revoke populates revoked_by server-side'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT public.cm_assert(
  NOT public.has_active_client_membership('13000000-0000-0000-0000-000000000003'),
  'revoke immediately makes helper false'
);
RESET ROLE;

\echo 'client-membership-substrate: category 8 scope discipline'

SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM (
    (SELECT * FROM policy_snapshot_before)
    EXCEPT
    (SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('signals', 'incidents', 'entities', 'reports'))
  ) diff),
  0,
  'migration does not remove or change existing intelligence table policies'
);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM (
    (SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('signals', 'incidents', 'entities', 'reports'))
    EXCEPT
    (SELECT * FROM policy_snapshot_before)
  ) diff),
  0,
  'migration does not add intelligence table policies'
);
SELECT public.cm_assert(
  to_regclass('public.profiles') IS NULL,
  'fixture has no profiles table, so membership cannot be inferred from profiles.client_id'
);
SELECT public.cm_assert(
  to_regclass('public.tenant_users') IS NULL,
  'fixture has no tenant_users table, so membership cannot be inferred from tenant_users'
);
SELECT public.cm_assert_eq(
  (SELECT count(*)::int FROM public.client_memberships),
  5,
  'no memberships are auto-created by migration'
);

\echo 'client-membership-substrate: behavioral test complete'
