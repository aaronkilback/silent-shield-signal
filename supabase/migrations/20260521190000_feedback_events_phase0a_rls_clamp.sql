-- ════════════════════════════════════════════════════════════════════════════
-- #130 / #143 — Phase 0A: feedback_events RLS clamp (emergency containment)
--
-- Defect: the policy "Analysts and admins full access to feedback_events"
-- granted ANY user with analyst OR admin app_role full read on feedback_events
-- with no tenant filter. Customer-side tenant admin (e.g. Vince at CRT) could
-- query the table via the supabase-js client and read every other tenant's
-- feedback notes (259 SSO rows visible to CRT admin today).
--
-- This migration replaces that broad policy with a tenant-scoped polymorphic
-- SELECT policy. Service-role bypass and own-feedback access are preserved.
--
-- Application-layer ML consumers run as service-role and bypass RLS — they are
-- closed separately via the FEEDBACK_LEARNING_PER_TENANT_ENABLED env var
-- (Phase 0A function patches) and proper tenant scoping (Phase 0B).
--
-- Phase 1 will replace this polymorphic chain with a direct tenant_id column.
-- This migration is intentionally minimal and reversible.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Analysts and admins full access to feedback_events"
  ON public.feedback_events;

-- Idempotent defensive drops for Phase 0A replacement policies
DROP POLICY IF EXISTS "phase0a_super_admin_bypass_feedback_events"
  ON public.feedback_events;
DROP POLICY IF EXISTS "phase0a_tenant_scoped_select_feedback_events"
  ON public.feedback_events;

CREATE POLICY "phase0a_super_admin_bypass_feedback_events"
  ON public.feedback_events FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- Tenant-scoped read via polymorphic chain (object_type='signal' → signals,
-- object_type='entity' → entities). Authors always see their own feedback via
-- the existing "Users can manage their own feedback events" policy.
CREATE POLICY "phase0a_tenant_scoped_select_feedback_events"
  ON public.feedback_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.signals s
      WHERE s.id = object_id
        AND object_type = 'signal'
        AND s.tenant_id IN (
          SELECT tu.tenant_id FROM public.tenant_users tu
          WHERE tu.user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.entities e
      WHERE e.id = object_id
        AND object_type = 'entity'
        AND e.tenant_id IN (
          SELECT tu.tenant_id FROM public.tenant_users tu
          WHERE tu.user_id = auth.uid()
        )
    )
  );

COMMENT ON POLICY "phase0a_tenant_scoped_select_feedback_events"
  ON public.feedback_events IS
  '#130 Phase 0A: polymorphic tenant scope via object_type chain. Replaced in Phase 1 with a direct tenant_id column.';
