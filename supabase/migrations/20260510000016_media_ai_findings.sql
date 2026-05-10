-- AI vision analysis on audit photos.
--
-- Phase 2E. Each uploaded photo gets analyzed by a vision LLM that
-- looks for things the operator may have missed:
--   • Gaps / damage on fence segments
--   • Broken padlocks, sagging gates
--   • Camera lens obstructions, exposed power cables
--   • Bulb-out lighting fixtures
--   • Faded / illegible signage
--   • Unauthorized objects in frame, tampering evidence
--
-- The LLM output is a PROPOSAL — the operator accepts or dismisses
-- each finding via a tap. Operator override always wins.
--
-- Anti-fabrication:
--   • Findings must cite a specific visual cue
--   • If image quality is poor, return zero findings + ask for re-shoot
--   • Severity grounded ('informational','monitor','concerning'); no
--     'critical' flagging from a single photo (humans decide that)

BEGIN;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS ai_findings        jsonb,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ai_analysis_status text
    CHECK (ai_analysis_status IS NULL OR ai_analysis_status IN ('pending','running','complete','failed','skipped')),
  ADD COLUMN IF NOT EXISTS ai_analysis_error  text;

CREATE INDEX IF NOT EXISTS media_assets_ai_status_idx
  ON public.media_assets(ai_analysis_status)
  WHERE ai_analysis_status IS NOT NULL AND deleted_at IS NULL;

-- Stage-level coverage sweep — meta-analysis across all photos in a
-- stage. "Across these 12 perimeter photos, what's NOT shown that
-- should be? what coverage gaps exist?"
CREATE TABLE IF NOT EXISTS public.audit_stage_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        uuid NOT NULL REFERENCES public.site_audits(id) ON DELETE CASCADE,
  stage           text NOT NULL,
  findings        jsonb NOT NULL,
  photos_analyzed integer NOT NULL DEFAULT 0,
  model           text,
  status          text NOT NULL CHECK (status IN ('running','complete','failed')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_stage_analyses_unique UNIQUE (audit_id, stage)
);

CREATE INDEX IF NOT EXISTS audit_stage_analyses_audit_idx
  ON public.audit_stage_analyses(audit_id);

ALTER TABLE public.audit_stage_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_stage_analyses_read_auth" ON public.audit_stage_analyses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_stage_analyses_write_service" ON public.audit_stage_analyses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "audit_stage_analyses_write_auth" ON public.audit_stage_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
