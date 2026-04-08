-- =============================================================================
-- WRAITH AI DEFENSE MODULE — Schema
-- Date: 2026-04-08
-- Creates tables for:
--   1. wraith_vulnerability_findings — code vulnerability scan results
--   2. wraith_signal_threat_scores — AI-generated attack detection on signals
--   3. wraith_prompt_injection_log — AEGIS prompt injection attempts
-- =============================================================================

-- ─── 1. VULNERABILITY FINDINGS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wraith_vulnerability_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         UUID NOT NULL,                          -- groups findings from one scan run
  file_path       TEXT NOT NULL,                          -- edge function file scanned
  title           TEXT NOT NULL,                          -- vulnerability title
  severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  cvss_score      NUMERIC(3,1),                           -- 0.0–10.0
  description     TEXT NOT NULL,
  location        TEXT,                                   -- function name / line reference
  recommendation  TEXT NOT NULL,
  cwe_id          TEXT,                                   -- CWE-XXX
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'fixed', 'false_positive')),
  signal_id       UUID REFERENCES public.signals(id) ON DELETE SET NULL,  -- auto-created signal
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wraith_vuln_scan_id   ON public.wraith_vulnerability_findings(scan_id);
CREATE INDEX idx_wraith_vuln_severity  ON public.wraith_vulnerability_findings(severity);
CREATE INDEX idx_wraith_vuln_status    ON public.wraith_vulnerability_findings(status);

ALTER TABLE public.wraith_vulnerability_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_wraith_vuln"
  ON public.wraith_vulnerability_findings FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "authenticated_read_wraith_vuln"
  ON public.wraith_vulnerability_findings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─── 2. SIGNAL THREAT SCORES ──────────────────────────────────────────────────
-- Every signal gets a threat DNA score assessing whether it's AI-generated attack content
CREATE TABLE IF NOT EXISTS public.wraith_signal_threat_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id             UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  ai_generated_score    NUMERIC(4,3) NOT NULL,              -- 0.000–1.000 probability of AI-generated attack
  synthetic_intel_score NUMERIC(4,3),                       -- probability of synthetic/fabricated intelligence
  adversarial_score     NUMERIC(4,3),                       -- probability of adversarial prompt injection in content
  threat_indicators     JSONB NOT NULL DEFAULT '[]',         -- array of specific detected indicators
  model_fingerprints    JSONB DEFAULT '[]',                  -- detected AI model signatures
  verdict               TEXT NOT NULL DEFAULT 'clean'
                          CHECK (verdict IN ('clean', 'suspicious', 'adversarial', 'synthetic_intel', 'blocked')),
  confidence            NUMERIC(4,3) NOT NULL,
  analysis_model        TEXT,                               -- which model performed the analysis
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_wraith_threat_signal ON public.wraith_signal_threat_scores(signal_id);
CREATE INDEX idx_wraith_threat_verdict        ON public.wraith_signal_threat_scores(verdict);
CREATE INDEX idx_wraith_threat_score          ON public.wraith_signal_threat_scores(ai_generated_score DESC);

ALTER TABLE public.wraith_signal_threat_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_wraith_threat"
  ON public.wraith_signal_threat_scores FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "authenticated_read_wraith_threat"
  ON public.wraith_signal_threat_scores FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─── 3. PROMPT INJECTION LOG ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wraith_prompt_injection_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT,                                    -- AEGIS session identifier
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message_preview  TEXT NOT NULL,                           -- first 200 chars (never full message)
  injection_type   TEXT,                                    -- role_override, data_exfil, tool_abuse, jailbreak, etc.
  confidence       NUMERIC(4,3) NOT NULL,
  action_taken     TEXT NOT NULL CHECK (action_taken IN ('allowed', 'flagged', 'blocked')),
  indicators       JSONB NOT NULL DEFAULT '[]',
  analysis_model   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wraith_injection_action    ON public.wraith_prompt_injection_log(action_taken);
CREATE INDEX idx_wraith_injection_type      ON public.wraith_prompt_injection_log(injection_type);
CREATE INDEX idx_wraith_injection_created   ON public.wraith_prompt_injection_log(created_at DESC);
CREATE INDEX idx_wraith_injection_user      ON public.wraith_prompt_injection_log(user_id);

ALTER TABLE public.wraith_prompt_injection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_wraith_injection"
  ON public.wraith_prompt_injection_log FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Only admins can read injection logs — sensitive security data
CREATE POLICY "admin_read_wraith_injection"
  ON public.wraith_prompt_injection_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ─── CRON: Nightly vulnerability scan at 06:00 UTC ────────────────────────────
SELECT cron.schedule(
  'wraith-vuln-scan-nightly',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/wraith-ai-defense',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"action": "run_vulnerability_scan"}'::jsonb
  )
  $$
);
