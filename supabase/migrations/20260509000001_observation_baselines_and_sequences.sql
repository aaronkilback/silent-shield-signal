-- ============================================================================
-- Tier 1A: Per-client observation baselines (Splunk Cookbook recipe)
-- Tier 1B: Multi-stage signal sequence detection (kill-chain analog)
-- ============================================================================
-- Adapts two recipes from the Splunk Threat Hunter's Cookbook (May 2026):
--
--   1A. "First-time-seen domain per client" — maintain a (client, kind, value)
--       lookup of earliest_seen / latest_seen so monitors can flag novelty
--       at signal-creation time. Replaces ad-hoc "is this new?" logic with
--       a single primitive every monitor can call. Cookbook page 25.
--
--   1B. "Multi-stage grouping" — group signals tied to the same client+anchor
--       within a time window into named SEQUENCES (announcement → mobilization
--       → physical proximity, etc.). Surfaces escalation patterns that
--       single-signal classification can't see. Cookbook page 9.
--
-- ============================================================================

-- ─── Tier 1A: client_observation_baselines ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_observation_baselines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  observation_kind text NOT NULL,
  observation_value text NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  metadata        jsonb,
  CONSTRAINT client_obs_unique UNIQUE (client_id, observation_kind, observation_value)
);

COMMENT ON TABLE public.client_observation_baselines IS
  'Tier 1A baseline: per-client first-time-seen tracking for source domains, user-agents, IPs, etc. Cookbook recipe — populated by ingest-signal and queried for novelty enrichment.';

CREATE INDEX IF NOT EXISTS cob_client_kind_lastseen_idx
  ON public.client_observation_baselines (client_id, observation_kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS cob_client_kind_firstseen_idx
  ON public.client_observation_baselines (client_id, observation_kind, first_seen_at DESC);

ALTER TABLE public.client_observation_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cob-service-all" ON public.client_observation_baselines;
CREATE POLICY "cob-service-all"
  ON public.client_observation_baselines
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "cob-auth-read" ON public.client_observation_baselines;
CREATE POLICY "cob-auth-read"
  ON public.client_observation_baselines
  FOR SELECT
  TO authenticated
  USING (true);


-- ─── Tier 1B: sequence_patterns + signal_sequences ────────────────────────

CREATE TABLE IF NOT EXISTS public.sequence_patterns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,
  description        text,
  stages             jsonb NOT NULL,
  window_seconds     integer NOT NULL DEFAULT 604800,        -- 7 days default
  min_stages_to_trigger integer NOT NULL DEFAULT 2,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sequence_patterns IS
  'Declarative multi-stage attack/escalation patterns. Each row defines an ordered set of stages — when ≥min_stages_to_trigger match within window_seconds for the same client+anchor, a signal_sequences row is created. Tier 1B from Splunk Cookbook adaptation.';

CREATE TABLE IF NOT EXISTS public.signal_sequences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id      uuid REFERENCES public.sequence_patterns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  anchor_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  anchor_label    text NOT NULL,
  signal_ids      uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  matched_stages  text[] NOT NULL DEFAULT ARRAY[]::text[],
  started_at      timestamptz NOT NULL,
  last_event_at   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','resolved','expired','dismissed')),
  sequence_score  numeric CHECK (sequence_score IS NULL OR (sequence_score >= 0 AND sequence_score <= 1)),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.signal_sequences IS
  'Detected multi-stage sequences. status=open means actively accumulating; escalated when sequence_score >= 0.66; expired when no new event within window.';

CREATE INDEX IF NOT EXISTS ss_client_status_idx
  ON public.signal_sequences (client_id, status, last_event_at DESC);

CREATE INDEX IF NOT EXISTS ss_pattern_anchor_idx
  ON public.signal_sequences (pattern_id, client_id, anchor_label, last_event_at DESC);

ALTER TABLE public.sequence_patterns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_sequences   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sp-service-all" ON public.sequence_patterns;
CREATE POLICY "sp-service-all" ON public.sequence_patterns TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sp-auth-read" ON public.sequence_patterns;
CREATE POLICY "sp-auth-read" ON public.sequence_patterns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ss-service-all" ON public.signal_sequences;
CREATE POLICY "ss-service-all" ON public.signal_sequences TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ss-auth-read" ON public.signal_sequences;
CREATE POLICY "ss-auth-read" ON public.signal_sequences FOR SELECT TO authenticated USING (true);


-- ─── Seed 3 starter patterns ──────────────────────────────────────────────

INSERT INTO public.sequence_patterns (name, description, stages, window_seconds, min_stages_to_trigger)
VALUES
  (
    'protest_escalation',
    'Activist mobilization sequence: announcement keywords → mobilization keywords → physical-domain signals on the same anchor (asset, location, or named entity) within 7 days.',
    '[
      {"name":"announcement","match":{"keywords":["call to action","mobilize","rally","protest planned","blockade","direct action","gathering at"]}},
      {"name":"mobilization","match":{"keywords":["arrived","convoy","encampment","occupation","camp","activists gathered"]}},
      {"name":"physical_proximity","match":{"category_in":["physical_security","wildfire","emergency"]}}
    ]'::jsonb,
    604800,
    2
  ),
  (
    'cyber_attack_chain',
    'Cyber escalation: vulnerability disclosure (CISA-KEV / CCCS) → exploit chatter (darkweb / pastebin) → credential leak / breach indicator on the same client tech stack within 14 days.',
    '[
      {"name":"vuln_disclosure","match":{"source_substr":["cisa-kev","cccs","threat-intel"]}},
      {"name":"exploit_chatter","match":{"source_substr":["darkweb","pastebin","github"]}},
      {"name":"credential_leak","match":{"signal_type_in":["credential_leak","data_breach","hibp_breach"]}}
    ]'::jsonb,
    1209600,
    2
  ),
  (
    'reputational_attack',
    'Coordinated reputational pressure: news article seed → social amplification → activist response within 3 days. Detects coordinated narrative attacks vs organic news cycles.',
    '[
      {"name":"news_seed","match":{"source_substr":["google_news","rss","news"]}},
      {"name":"social_amplification","match":{"source_substr":["twitter","facebook","instagram","reddit","tiktok"]}},
      {"name":"activist_response","match":{"keywords":["respond","statement","condemn","demand","accountability","investigation"]}}
    ]'::jsonb,
    259200,
    2
  )
ON CONFLICT (name) DO NOTHING;


-- ─── Cron registry entries (heartbeats) ───────────────────────────────────

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('detect-signal-sequences-30min', 30, 'Tier 1B: detect multi-stage signal sequences against active patterns', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  description = EXCLUDED.description;
