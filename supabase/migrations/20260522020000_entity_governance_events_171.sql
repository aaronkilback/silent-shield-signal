-- #171 — Entity governance audit table
--
-- Records every attempted entity persistence (success OR rejection) from
-- governed writers: dashboard-ai-assistant create_entity, correlate-entities,
-- extract-signal-insights.
--
-- DOCTRINE COMPLIANCE
--   - tenant_id NOT NULL (Phase 1 pattern — every learning-adjacent surface)
--   - RLS: tenant-scoped SELECT for analysts/admins; service-role write; super_admin omniscient
--   - This is forensic telemetry, NOT feedback learning — no aggregation into platform state.

BEGIN;

CREATE TABLE IF NOT EXISTS public.entity_governance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant boundary (Phase 1 doctrine)
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Which writer attempted the persistence
  source_writer text NOT NULL,
    -- Expected values: 'aegis_create_entity' | 'correlate_entities' | 'extract_signal_insights' | 'other'

  -- Candidate identity (truncated for storage)
  candidate_name text NOT NULL,
  candidate_type text,
  candidate_origin text,
    -- Expected values: 'regex' | 'llm' | 'human' | 'curated'

  -- Governance verdict
  verdict text NOT NULL CHECK (verdict IN ('auto_link','suggestion_queue','auto_reject')),

  -- Why rejected (multiple reasons can fire together)
  rejection_reasons text[] NOT NULL DEFAULT '{}',

  -- Non-fatal observations (e.g. "person classification demoted")
  warnings text[] NOT NULL DEFAULT '{}',

  -- Post-validation confidence (caller persists this if queued)
  confidence numeric,

  -- Forensic traceability (signal_id, document_id, etc.)
  source_context jsonb,

  -- Cross-references (for auto_link or duplicate detection)
  linked_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  suggestion_id uuid REFERENCES public.entity_suggestions(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Common query paths
CREATE INDEX IF NOT EXISTS idx_egf_tenant_writer_created
  ON public.entity_governance_events(tenant_id, source_writer, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_egf_tenant_verdict_created
  ON public.entity_governance_events(tenant_id, verdict, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_egf_tenant_type_created
  ON public.entity_governance_events(tenant_id, candidate_type, created_at DESC)
  WHERE candidate_type IS NOT NULL;

-- Rejection-reason analytics index (GIN on text[])
CREATE INDEX IF NOT EXISTS idx_egf_rejection_reasons
  ON public.entity_governance_events USING GIN (rejection_reasons);

COMMENT ON TABLE public.entity_governance_events IS
  '#171 — Per-attempt entity persistence audit log. Every writer that proposes a new entity logs its verdict here. Tenant-scoped (Phase 1 doctrine). Forensic telemetry only — not feedback learning.';

COMMENT ON COLUMN public.entity_governance_events.source_writer IS
  'Which writer proposed the entity: aegis_create_entity | correlate_entities | extract_signal_insights | other';

COMMENT ON COLUMN public.entity_governance_events.candidate_origin IS
  'Extraction modality: regex (heuristic, never authoritative) | llm (needs corroboration) | human | curated';

COMMENT ON COLUMN public.entity_governance_events.verdict IS
  'Three-tier verdict. auto_link = matched existing entity. suggestion_queue = passed validation, awaiting review. auto_reject = failed ontology/dedupe/source-aware checks. NO auto_create — weak extraction never persists directly to entities.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.entity_governance_events ENABLE ROW LEVEL SECURITY;

-- Tenant analysts/admins can read their own tenant's events
CREATE POLICY entity_governance_events_tenant_select
  ON public.entity_governance_events
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tu.tenant_id FROM public.tenant_users tu WHERE tu.user_id = auth.uid()
    )
  );

-- Super_admin omniscient
CREATE POLICY entity_governance_events_super_admin_all
  ON public.entity_governance_events
  FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Service-role: full access (edge functions write through this path)
CREATE POLICY entity_governance_events_service_role
  ON public.entity_governance_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
