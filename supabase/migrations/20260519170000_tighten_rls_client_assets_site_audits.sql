-- 2026-05-19 — Tenant-isolation hardening for client_assets,
-- site_audits, and site_observations.
--
-- Background:
--   Migration 20260510000012_client_assets_site_audits.sql created
--   these tables with intentionally-loose RLS ("Phase 2A: authenticated
--   users can read everything") and a TODO that per-client scoping
--   would land in a follow-up. That follow-up never happened, so the
--   production database currently has:
--
--     CREATE POLICY ... FOR SELECT TO authenticated USING (true)
--
--   on all three tables — a real tenant-isolation regression. A user
--   in tenant A can read every tenant's site audits / assets /
--   observations from a stock PostgREST call. This migration replaces
--   those policies with the same client_id-scoped pattern used by
--   signals / entities / incidents
--   (qual: client_id IN get_user_accessible_client_ids()) so the same
--   security boundary applies to all six classes of tenant data.
--
-- Write semantics:
--   Tenant membership is the hard security boundary; primary_operator
--   is workflow authorization, layered ON TOP. Writes therefore
--   require BOTH:
--     - client_id is in caller's get_user_accessible_client_ids()
--     - auth.uid() = primary_operator  (site_audits + site_observations only)
--
-- Pre-condition validated read-only on prod before this migration was
-- written:
--   client_assets:     3 rows, 0 orphan client_id
--   site_audits:       3 rows, 0 orphan client_id
--   site_observations: 18 rows, 0 orphan audit_id
--   → no legitimate row is locked out by the new policies.
--
-- Companion: the tenant-isolation invariant test
-- (src/test/security/tenant-isolation.invariant.test.ts) is extended
-- in the same commit to assert negative and positive coverage for all
-- three tables.

BEGIN;

-- ── client_assets ────────────────────────────────────────────────
DROP POLICY IF EXISTS "client_assets_read_all_auth" ON public.client_assets;
DROP POLICY IF EXISTS "client_assets_write_auth" ON public.client_assets;

CREATE POLICY "client_assets_tenant_select" ON public.client_assets
  FOR SELECT
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  );

CREATE POLICY "client_assets_tenant_insert" ON public.client_assets
  FOR INSERT
  WITH CHECK (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  );

CREATE POLICY "client_assets_tenant_update" ON public.client_assets
  FOR UPDATE
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  )
  WITH CHECK (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  );

CREATE POLICY "client_assets_tenant_delete" ON public.client_assets
  FOR DELETE
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  );

CREATE POLICY "super_admin_bypass_client_assets" ON public.client_assets
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ── site_audits ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "site_audits_read_all_auth" ON public.site_audits;
DROP POLICY IF EXISTS "site_audits_write_own" ON public.site_audits;

CREATE POLICY "site_audits_tenant_select" ON public.site_audits
  FOR SELECT
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
  );

CREATE POLICY "site_audits_tenant_insert" ON public.site_audits
  FOR INSERT
  WITH CHECK (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
    AND auth.uid() = primary_operator
  );

CREATE POLICY "site_audits_tenant_update" ON public.site_audits
  FOR UPDATE
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
    AND auth.uid() = primary_operator
  )
  WITH CHECK (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
    AND auth.uid() = primary_operator
  );

CREATE POLICY "site_audits_tenant_delete" ON public.site_audits
  FOR DELETE
  USING (
    client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
    AND auth.uid() = primary_operator
  );

CREATE POLICY "super_admin_bypass_site_audits" ON public.site_audits
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ── site_observations ────────────────────────────────────────────
-- No client_id column on the row itself; scope is derived through
-- site_audits via audit_id.
DROP POLICY IF EXISTS "site_observations_read_all_auth" ON public.site_observations;
DROP POLICY IF EXISTS "site_observations_write_own_audit" ON public.site_observations;

CREATE POLICY "site_observations_tenant_select" ON public.site_observations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.site_audits sa
      WHERE sa.id = site_observations.audit_id
        AND sa.client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
    )
  );

CREATE POLICY "site_observations_tenant_insert" ON public.site_observations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.site_audits sa
      WHERE sa.id = site_observations.audit_id
        AND sa.client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
        AND sa.primary_operator = auth.uid()
        AND sa.status = 'in_progress'
    )
  );

CREATE POLICY "site_observations_tenant_update" ON public.site_observations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.site_audits sa
      WHERE sa.id = site_observations.audit_id
        AND sa.client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
        AND sa.primary_operator = auth.uid()
        AND sa.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.site_audits sa
      WHERE sa.id = site_observations.audit_id
        AND sa.client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
        AND sa.primary_operator = auth.uid()
        AND sa.status = 'in_progress'
    )
  );

CREATE POLICY "site_observations_tenant_delete" ON public.site_observations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.site_audits sa
      WHERE sa.id = site_observations.audit_id
        AND sa.client_id IN (SELECT client_id FROM public.get_user_accessible_client_ids())
        AND sa.primary_operator = auth.uid()
        AND sa.status = 'in_progress'
    )
  );

CREATE POLICY "super_admin_bypass_site_observations" ON public.site_observations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

COMMIT;
