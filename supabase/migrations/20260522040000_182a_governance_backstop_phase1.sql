-- #182A — Runtime governance backstop (Phase 1: infrastructure, no trigger yet)
--
-- Phase 1 sequencing (per Aaron approval 2026-05-22):
--   1. Schema infrastructure: enum, composite types, policy tables,
--      nullable governance_event_id columns, partial index. [THIS MIGRATION]
--   2. SECURITY DEFINER persistence RPCs. [SEE 20260522040001_182a_governance_rpcs.sql]
--   3. Module helper persistGovernanceVerdict added; existing recordGovernanceEvent
--      retained for transition compatibility.
--   4. Canary writer wired to RPC; observed behavior validated.
--   5. Remaining writers migrated batch-by-batch.
--   6. BEFORE INSERT + BEFORE UPDATE triggers attached (next migration).
--   7. Legacy backfill + NOT NULL hardening (#182B, gated).
--
-- DOCTRINE
--   - Audit-first transactional: governance event row created BEFORE governed row
--   - Composite type contract: typo-safe parameter signatures, no jsonb at boundary
--   - Policy-table-driven authorization: source_writer + caller_intent gates live
--     in entity_governance_writer_policy, NOT hardcoded in RPC SQL
--   - SECURITY DEFINER with explicit per-intent authorization (no god-mode bypass)
--   - service_role privilege is NOT proof of intent; caller_intent must be declared
--
-- STRUCTURAL NOTE: This migration was originally written as a single combined
-- file but live staging history splits it into two consecutive migrations
-- (schema first, RPCs second). Repo files mirror that split so re-running
-- against a fresh database produces an identical migration history.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. ENUM type for caller intent
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE public.governance_caller_intent AS ENUM (
  'operator_action',     -- human-mediated request via authenticated user JWT
  'autonomous_system',   -- cron / autonomous Edge Function pipelines (LLM, regex, scheduled)
  'migration',           -- migration-time INSERTs (legacy backfill, seed data)
  'maintenance'          -- manual super_admin DBA operation with explicit reason
);

COMMENT ON TYPE public.governance_caller_intent IS
  '#182A — Caller intent taxonomy. Every governance write must declare an intent. service_role privilege alone is not proof of intent — caller must declare one of these classes and satisfy its evidence requirements (see governance_persist_* RPC functions).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Composite types — typed contract (replaces free-form jsonb at boundary)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE public.governance_event_input AS (
  tenant_id uuid,
  source_writer text,
  candidate_name text,
  candidate_type text,
  candidate_origin text,
  verdict text,
  rejection_reasons text[],
  warnings text[],
  confidence numeric,
  source_context jsonb,    -- jsonb intentional: source-specific opaque payload
  bypass_metadata jsonb,   -- jsonb intentional: audit detail varies by bypass class
  caller_intent public.governance_caller_intent,
  matched_entity_id uuid,
  linked_entity_id uuid
);

CREATE TYPE public.entity_suggestion_input AS (
  tenant_id uuid,
  suggested_name text,
  suggested_type text,
  suggested_aliases text[],
  suggested_attributes jsonb,
  source_type text,
  source_id uuid,
  confidence numeric,
  context text,
  status text,
  matched_entity_id uuid
);

CREATE TYPE public.entity_input AS (
  tenant_id uuid,
  name text,
  type text,
  description text,
  aliases text[],
  risk_level text,
  threat_score integer,
  threat_indicators text[],
  associations text[],
  attributes jsonb,
  address_street text,
  address_city text,
  address_province text,
  address_postal_code text,
  address_country text,
  current_location text,
  active_monitoring_enabled boolean,
  monitoring_radius_km numeric,
  client_id uuid,
  confidence_score numeric,
  is_active boolean,
  entity_status text,
  visibility_class text
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Verdict allowlist policy table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.entity_governance_verdict_policy (
  target_table text NOT NULL,
  allowed_verdict text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  rationale text NOT NULL,
  PRIMARY KEY (target_table, allowed_verdict)
);

INSERT INTO public.entity_governance_verdict_policy (target_table, allowed_verdict, rationale) VALUES
  ('entities',            'operator_promoted',     '#179 H-1: explicit operator action with audited bypass_metadata'),
  ('entities',            'legacy_pre_governance', '#182B: historical rows predating governance (gated backfill)'),
  ('entity_suggestions',  'suggestion_queue',      '#171: passed governance validation, awaiting human review'),
  ('entity_suggestions',  'legacy_pre_governance', '#182B: historical rows predating governance (gated backfill)');

COMMENT ON TABLE public.entity_governance_verdict_policy IS
  '#182A — Allowlist of verdict values permitted to create new rows in each governed table. Trigger consults this table; never hardcodes verdict checks in SQL.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Writer authorization policy table (policy-driven, not hardcoded)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.entity_governance_writer_policy (
  source_writer text NOT NULL,
  allowed_intent public.governance_caller_intent NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_writer, allowed_intent)
);

INSERT INTO public.entity_governance_writer_policy (source_writer, allowed_intent, notes) VALUES
  -- AEGIS tool surface (autonomous LLM decision under operator session)
  ('aegis_create_entity',           'autonomous_system', '#171 dashboard-ai-assistant + agent-chat create_entity tool'),
  ('aegis_create_entity',           'operator_action',   '#179 H-1 create-entity REST endpoint operator path'),
  ('agent_chat',                    'autonomous_system', '#179 H-1 agent-chat suggest_entity + create_entity tools'),
  -- Signal/document extraction pipelines (LLM/regex)
  ('correlate_entities',            'autonomous_system', '#171 signal-text regex extractor'),
  ('extract_signal_insights',       'autonomous_system', '#171 LLM signal extractor'),
  ('extract_predicted_events',      'autonomous_system', '#179 H-1 LLM cron event extractor'),
  ('osint_entity_scan',             'autonomous_system', '#179 H-1 LLM OSINT associate discovery'),
  ('process_intelligence_document', 'autonomous_system', '#179 H-1 LLM document intelligence extractor'),
  ('process_stored_document',       'autonomous_system', '#179 H-2 LLM document ingestion'),
  ('parse_entities_document',       'autonomous_system', '#179 H-3 LLM document parsing'),
  ('process_security_report',       'autonomous_system', '#179 H-3 LLM security report extraction'),
  ('auto_enrich_entities',          'autonomous_system', '#179 H-2 LLM cron entity enrichment'),
  -- Operator-mediated direct entity creation
  ('vip_deep_scan',                 'operator_action',   '#179 H-1 VIP intake operator-mediated entity creation'),
  -- Catchall for the existing source_writer='other' usage (kept for #171 compatibility)
  ('other',                         'autonomous_system', '#171 default for misc autonomous callers; should be tightened over time'),
  -- Migration / maintenance / legacy
  ('legacy_pre_governance',         'migration',         '#182B legacy sentinel backfill (one event per tenant)'),
  ('manual_maintenance',            'maintenance',       '#182A super_admin direct intervention with audit reason');

COMMENT ON TABLE public.entity_governance_writer_policy IS
  '#182A — Authorization policy. Maps source_writer × caller_intent → allowed. RPCs consult this table; never hardcode source_writer whitelists in SQL. Adding a writer = INSERT row (deliberate). Deactivating = UPDATE active=false (auditable). Policy lookup is the actual security boundary.';

CREATE INDEX idx_entity_governance_writer_policy_active
  ON public.entity_governance_writer_policy(source_writer, allowed_intent)
  WHERE active = true;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Nullable governance_event_id columns on governed tables
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS governance_event_id uuid
  REFERENCES public.entity_governance_events(id) ON DELETE SET NULL;

ALTER TABLE public.entity_suggestions
  ADD COLUMN IF NOT EXISTS governance_event_id uuid
  REFERENCES public.entity_governance_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.entities.governance_event_id IS
  '#182A — FK to the governance event that authorized this row. NULL on historical rows pre-#182. Trigger (added in 182A Phase 2 after writer migration) will enforce NOT NULL for new inserts.';

COMMENT ON COLUMN public.entity_suggestions.governance_event_id IS
  '#182A — FK to the governance event that authorized this row. NULL on historical rows pre-#182. Trigger (added in 182A Phase 2 after writer migration) will enforce NOT NULL for new inserts.';

-- Observability index: distinguish historical NULLs from any future bypass
CREATE INDEX idx_entities_no_governance_event_id
  ON public.entities(created_at DESC)
  WHERE governance_event_id IS NULL;

CREATE INDEX idx_entity_suggestions_no_governance_event_id
  ON public.entity_suggestions(created_at DESC)
  WHERE governance_event_id IS NULL;

-- Extend verdict CHECK on entity_governance_events to include legacy_pre_governance
ALTER TABLE public.entity_governance_events
  DROP CONSTRAINT IF EXISTS entity_governance_events_verdict_check;

ALTER TABLE public.entity_governance_events
  ADD CONSTRAINT entity_governance_events_verdict_check
  CHECK (verdict IN ('auto_link','suggestion_queue','auto_reject','operator_promoted','legacy_pre_governance'));

COMMIT;
