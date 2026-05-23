-- ════════════════════════════════════════════════════════════════════════════
-- PROD-O Step 2 (2026-05-23) — entity tenant-client consistency invariant.
--
-- Closes the failure class PROD-O surfaced: entities written with
-- tenant_id pointing at one tenant while client_id points at a client
-- owned by a different tenant. Step 1 closed the only known producer
-- (EntitySuggestionsPanel approval fallback to selectedClientId).
-- Step 2 makes the invariant unbypassable at the DB level so future
-- writers (existing or new) cannot recreate the failure class.
--
-- Invariant:
--   if entities.client_id IS NOT NULL AND entities.tenant_id IS NOT NULL,
--   then entities.tenant_id must equal the tenant_id of the referenced
--   client.
--
-- Pre-deploy audit re-run at apply time (mandatory per Aaron):
--   SELECT COUNT(*) FROM entities e
--   JOIN clients c ON c.id = e.client_id
--   WHERE e.client_id IS NOT NULL
--     AND e.tenant_id IS NOT NULL
--     AND c.tenant_id IS NOT NULL
--     AND e.tenant_id <> c.tenant_id;
-- 2026-05-23 audit: 0 historical violations.
--
-- Trigger scope: BEFORE INSERT OR UPDATE OF tenant_id, client_id.
--   - INSERT always fires (every column included)
--   - UPDATE fires only when tenant_id or client_id is in the SET list.
--     UPDATEs of unrelated columns (description, risk_level, aliases,
--     threat_indicators, updated_at, entity_status, confidence_score)
--     do NOT re-fire the check. Confirmed-safe writers like
--     auto-enrich-entities / process-feedback / osint-web-search pass
--     through unaffected.
--
-- Allows transient states (trigger short-circuits):
--   - client_id IS NULL  → no constraint
--   - tenant_id IS NULL  → no constraint (NULL-tenant entities tracked
--                          separately under task #203)
--
-- Companion code: supabase/functions/system-watchdog/index.ts
-- `fix_orphaned_entities` case rewrite ships in the same release. The
-- previous bulk-UPDATE-with-arbitrary-default-client would have been
-- blocked by this trigger; the rewrite groups orphans by their own
-- tenant_id and assigns within-tenant via a deterministic per-tenant
-- default-client selection.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_entities_tenant_client_consistency
--     ON public.entities;
--   DROP FUNCTION IF EXISTS
--     public.assert_entity_tenant_matches_client();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assert_entity_tenant_matches_client()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_tenant uuid;
BEGIN
  IF NEW.client_id IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_client_tenant
  FROM public.clients
  WHERE id = NEW.client_id;

  -- Missing client row: FK constraint will catch it; don't double-fire.
  IF v_client_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id <> v_client_tenant THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'PROD-O invariant: entities.tenant_id (%s) does not match clients.tenant_id (%s) for client_id %s. '
        'Entity tenant must match its client''s tenant.',
        NEW.tenant_id, v_client_tenant, NEW.client_id
      );
  END IF;

  RETURN NEW;
END;
$$;

-- Drop-then-create (vs CREATE OR REPLACE TRIGGER) for compatibility with
-- prior partial-deploy state. Idempotent.
DROP TRIGGER IF EXISTS trg_entities_tenant_client_consistency ON public.entities;

CREATE TRIGGER trg_entities_tenant_client_consistency
BEFORE INSERT OR UPDATE OF tenant_id, client_id ON public.entities
FOR EACH ROW
EXECUTE FUNCTION public.assert_entity_tenant_matches_client();

COMMENT ON FUNCTION public.assert_entity_tenant_matches_client() IS
  'PROD-O integrity invariant. Rejects entity writes where tenant_id != clients.tenant_id for the referenced client. NULL client_id or NULL tenant_id passes through.';
