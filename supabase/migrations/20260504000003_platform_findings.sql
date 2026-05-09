-- Platform findings — Phase 2 of the Neural Constellation diagnostic
-- overlay. system-watchdog already detects behavioral-health issues
-- ("agent enrichment coverage gap", "social monitor 0-yield", "BCWS
-- endpoint failing", etc.) every run, but the findings have only
-- ever lived in the daily watchdog email. Persisting them lets the
-- /neural-constellation page pin the live finding list onto specific
-- agent nodes — turning the watchdog's reasoning into a visual that
-- screams when something's broken.
--
-- Design notes:
--   - Upsert keyed on (run_id) + a stable fingerprint so re-runs
--     don't flood the table.
--   - Soft-resolve via resolved_at — a finding that disappears from
--     the most-recent watchdog run gets its resolved_at stamped so
--     the UI auto-clears it without a manual action.
--   - affected_agent / affected_job are nullable — many findings
--     are platform-wide and don't pin to one node.

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_findings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint     TEXT         NOT NULL UNIQUE,  -- stable hash of category+title+resource so re-runs upsert
  category        TEXT         NOT NULL,         -- behavioral_health / health_check / cron_failure / etc.
  severity        TEXT         NOT NULL,         -- info / low / medium / high / critical
  title           TEXT         NOT NULL,
  analysis        TEXT,                          -- detailed evidence
  plain_english   TEXT,                          -- operator-facing one-liner
  action          TEXT,                          -- recommended next step
  affected_agent  TEXT,                          -- call_sign of the agent (NULL for platform-wide)
  affected_job    TEXT,                          -- cron job name (NULL when not job-related)
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,                   -- NULL while active
  resolution_note TEXT,                          -- explanation when manually closed or auto-cleared
  occurrence_count INTEGER     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_platform_findings_active
  ON public.platform_findings (resolved_at, severity, last_seen_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_findings_affected_agent
  ON public.platform_findings (affected_agent, resolved_at)
  WHERE resolved_at IS NULL AND affected_agent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_findings_affected_job
  ON public.platform_findings (affected_job, resolved_at)
  WHERE resolved_at IS NULL AND affected_job IS NOT NULL;

-- RLS — match the signals table pattern: super_admin bypass +
-- analyst/admin can read.
ALTER TABLE public.platform_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_findings_select" ON public.platform_findings;
CREATE POLICY "platform_findings_select"
  ON public.platform_findings FOR SELECT
  USING (
    is_super_admin(auth.uid())
    OR has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'viewer'::app_role)
  );

DROP POLICY IF EXISTS "platform_findings_service_write" ON public.platform_findings;
CREATE POLICY "platform_findings_service_write"
  ON public.platform_findings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;

COMMENT ON TABLE public.platform_findings IS
  'Live behavioral / health findings produced by system-watchdog. UI uses this to overlay warnings on the Neural Constellation. Findings auto-resolve when they stop appearing in subsequent watchdog runs.';
COMMENT ON COLUMN public.platform_findings.fingerprint IS
  'Stable hash of (category, title-prefix, affected_resource) — re-runs upsert against this so the same finding doesn''t accumulate duplicate rows.';
COMMENT ON COLUMN public.platform_findings.affected_agent IS
  'Agent call_sign (e.g. WILDFIRE, NEO) when the finding pins to a specific agent. Used by the constellation overlay to glow that node.';
