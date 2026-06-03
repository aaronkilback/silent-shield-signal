-- =============================================================================
-- P0 tenant-attribution repair (GO-FORWARD): derive child tenant_id/client_id
-- from the parent signal on INSERT.
-- =============================================================================
-- Root cause: phase2_m2 (2026-05-18) added tenant_id/client_id columns + tenant
-- RLS + a one-time backfill to signal_agent_analyses (and incidents got tenancy
-- earlier), DERIVED FROM THE PARENT SIGNAL — but never added a go-forward
-- mechanism. The writers (ai-decision-engine, review-signal-agent, etc.) never
-- set these fields. signals got a derive trigger (bug45, 05-19); the child tables
-- never did. Result: every analysis/incident since 05-18 is tenant_id=NULL and
-- invisible to Aegis's tenant_id-filtered retrieval + common-operating-picture.
--
-- This completes the Phase-1 ownership model (derive-from-parent), mirroring
-- signals_derive_tenant_id. SCOPE: signal_agent_analyses + incidents ONLY.
--
-- SAFETY: fail-open. Local vars + FOUND guard (never NULL-out an explicit value
-- on a missing parent); EXCEPTION WHEN OTHERS -> RETURN NEW so a derivation error
-- can NEVER break the live analysis/incident write path. Worst case = NULL column
-- (recoverable by re-backfill), never a lost insert.
--
-- ROLLBACK: DROP TRIGGER trg_derive_analysis_tenant ON public.signal_agent_analyses;
--           DROP TRIGGER trg_derive_incident_tenant ON public.incidents;
--           DROP FUNCTION public.derive_analysis_tenant();
--           DROP FUNCTION public.derive_incident_tenant();
-- (Reverts to status-quo-ante: new rows NULL again — no worse than pre-repair.)

-- 1. signal_agent_analyses ← parent signal (both fields)
CREATE OR REPLACE FUNCTION public.derive_analysis_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_client uuid;
BEGIN
  IF NEW.signal_id IS NOT NULL AND (NEW.tenant_id IS NULL OR NEW.client_id IS NULL) THEN
    SELECT s.tenant_id, s.client_id INTO v_tenant, v_client
      FROM public.signals s WHERE s.id = NEW.signal_id;
    IF FOUND THEN
      NEW.tenant_id := COALESCE(NEW.tenant_id, v_tenant);
      NEW.client_id := COALESCE(NEW.client_id, v_client);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- fail-open: never break the write path
END;$$;

DROP TRIGGER IF EXISTS trg_derive_analysis_tenant ON public.signal_agent_analyses;
CREATE TRIGGER trg_derive_analysis_tenant
  BEFORE INSERT ON public.signal_agent_analyses
  FOR EACH ROW EXECUTE FUNCTION public.derive_analysis_tenant();

-- 2. incidents ← parent signal, fallback client_id -> clients for tenant
CREATE OR REPLACE FUNCTION public.derive_incident_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_client uuid; c_tenant uuid;
BEGIN
  IF NEW.signal_id IS NOT NULL AND (NEW.tenant_id IS NULL OR NEW.client_id IS NULL) THEN
    SELECT s.tenant_id, s.client_id INTO v_tenant, v_client
      FROM public.signals s WHERE s.id = NEW.signal_id;
    IF FOUND THEN
      NEW.tenant_id := COALESCE(NEW.tenant_id, v_tenant);
      NEW.client_id := COALESCE(NEW.client_id, v_client);
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT tenant_id INTO c_tenant FROM public.clients WHERE id = NEW.client_id;
    IF FOUND THEN NEW.tenant_id := c_tenant; END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_derive_incident_tenant ON public.incidents;
CREATE TRIGGER trg_derive_incident_tenant
  BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.derive_incident_tenant();
