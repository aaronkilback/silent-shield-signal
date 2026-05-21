-- ════════════════════════════════════════════════════════════════════════════
-- #112 — Parameterized overload of get_user_accessible_client_ids()
--
-- The existing public.get_user_accessible_client_ids() takes no parameter and
-- uses auth.uid() internally. That's correct for RLS contexts (clients SELECT
-- policy depends on it), but unusable from service-role edge function contexts
-- where auth.uid() returns NULL.
--
-- This migration adds a parameterized overload with the SAME join semantics,
-- so the F-026 auth gate in ingest-signal (and any future verify_jwt=false
-- function adopting the same posture) can determine accessible-client membership
-- for a specific user_id without depending on auth.uid().
--
-- Defense-in-depth: the new overload explicitly excludes clients with NULL
-- tenant_id, even though no such rows exist in prod today. Schema allows
-- NULL, and a future malformed row must not silently become accessible.
--
-- The no-arg version is left untouched. Both functions return the same shape
-- and are intended to remain semantically aligned. Any future change to the
-- join logic must be applied to BOTH functions in the same migration.
--
-- See:
--   - #112 (this work) — F-026 helper restore
--   - #102 (umbrella architectural defect)
--   - docs/audit-evidence/f-025-validation-2026-05-13/README.md (F-025 precedent)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_accessible_client_ids(_user_id uuid)
 RETURNS TABLE(client_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT c.id
  FROM public.clients c
  INNER JOIN public.tenant_users tu ON tu.tenant_id = c.tenant_id
  WHERE tu.user_id = _user_id
    AND c.tenant_id IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_user_accessible_client_ids(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_accessible_client_ids(uuid) IS
  'Parameterized overload of get_user_accessible_client_ids() for use from '
  'service-role edge function contexts where auth.uid() is NULL. Used by '
  'F-026 gate in ingest-signal (and any future verify_jwt=false function). '
  'The no-arg version (used by RLS) remains the canonical RLS join. Both '
  'must be kept semantically aligned.';
