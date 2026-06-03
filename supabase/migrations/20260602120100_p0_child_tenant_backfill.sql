-- =============================================================================
-- P0 tenant-attribution repair (BACKFILL): restore historical NULL-tenant rows
-- on signal_agent_analyses + incidents, derived from the parent signal/client.
-- =============================================================================
-- Run AFTER the go-forward triggers (20260602120000) so no new orphans accrue
-- during the backfill. Idempotent (WHERE ... IS NULL). Derives strictly from the
-- authoritative parent → cannot mis-assign tenancy (no cross-tenant leak).
--
-- Pre-state invariant (verified 2026-06-02): orphaned rows are both-NULL
-- (tenant_id and client_id co-vary), so re-NULLing audited rows is an exact rollback.
--
-- ROLLBACK:
--   UPDATE public.signal_agent_analyses SET tenant_id=NULL, client_id=NULL
--     WHERE id IN (SELECT row_id FROM public._repair_tenant_backfill_20260602 WHERE tbl='signal_agent_analyses');
--   UPDATE public.incidents SET tenant_id=NULL, client_id=NULL
--     WHERE id IN (SELECT row_id FROM public._repair_tenant_backfill_20260602 WHERE tbl='incidents');
--   DROP TABLE public._repair_tenant_backfill_20260602;

CREATE TABLE IF NOT EXISTS public._repair_tenant_backfill_20260602 (
  tbl text NOT NULL,
  row_id uuid NOT NULL,
  set_tenant_id uuid,
  set_client_id uuid,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);

-- 1. analyses ← parent signal
WITH upd AS (
  UPDATE public.signal_agent_analyses saa
     SET tenant_id = COALESCE(saa.tenant_id, s.tenant_id),
         client_id = COALESCE(saa.client_id, s.client_id)
    FROM public.signals s
   WHERE saa.signal_id = s.id
     AND (saa.tenant_id IS NULL OR saa.client_id IS NULL)
     AND (s.tenant_id IS NOT NULL OR s.client_id IS NOT NULL)
  RETURNING saa.id, saa.tenant_id, saa.client_id
)
INSERT INTO public._repair_tenant_backfill_20260602 (tbl, row_id, set_tenant_id, set_client_id)
SELECT 'signal_agent_analyses', id, tenant_id, client_id FROM upd;

-- 2. incidents ← parent signal
WITH upd AS (
  UPDATE public.incidents i
     SET tenant_id = COALESCE(i.tenant_id, s.tenant_id),
         client_id = COALESCE(i.client_id, s.client_id)
    FROM public.signals s
   WHERE i.signal_id = s.id
     AND (i.tenant_id IS NULL OR i.client_id IS NULL)
     AND (s.tenant_id IS NOT NULL OR s.client_id IS NOT NULL)
  RETURNING i.id, i.tenant_id, i.client_id
)
INSERT INTO public._repair_tenant_backfill_20260602 (tbl, row_id, set_tenant_id, set_client_id)
SELECT 'incidents', id, tenant_id, client_id FROM upd;

-- 3. incidents with no signal ← client_id -> clients (tenant only)
WITH upd AS (
  UPDATE public.incidents i
     SET tenant_id = c.tenant_id
    FROM public.clients c
   WHERE i.client_id = c.id
     AND i.tenant_id IS NULL
     AND c.tenant_id IS NOT NULL
  RETURNING i.id, i.tenant_id, i.client_id
)
INSERT INTO public._repair_tenant_backfill_20260602 (tbl, row_id, set_tenant_id, set_client_id)
SELECT 'incidents', id, tenant_id, client_id FROM upd;
