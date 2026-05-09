-- CARVER infrastructure scoring — May 2026.
--
-- CARVER is a target/asset assessment methodology used by special
-- operations and infrastructure protection planners. Each asset is
-- scored 1–5 on six dimensions:
--
--   C — Criticality       (mission impact if disrupted)
--   A — Accessibility     (how easily a threat can reach the asset)
--   R — Recuperability    (recovery time after damage; INVERSE — slow recovery = HIGH score)
--   V — Vulnerability     (asset's exposure to known attack methods)
--   E — Effect            (cascading consequences — psychological, economic, operational)
--   R — Recognizability   (ease of identifying the asset as a target)
--
-- Total CARVER score = sum of the six dimensions, range 6–30. Higher
-- score = more attractive / higher-priority target. Conventional
-- thresholds:
--
--   24–30  Critical priority — top-tier targets requiring active hardening
--   18–23  High priority    — significant attention warranted
--   12–17  Medium priority  — baseline protective measures
--    6–11  Low priority     — opportunistic only
--
-- Background: agents on the platform have referenced CARVER as
-- analytical language since the platform was built (see
-- aegis-persona.ts), but until this migration there was no per-asset
-- scoring infrastructure — agents could DESCRIBE the framework but
-- couldn't return a CARVER score for a specific Petronas asset. The
-- partner-facing capability summary explicitly claims CARVER scoring;
-- this migration makes that claim load-bearing.

BEGIN;

-- ─── 1. Schema ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_carver_scores (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID         NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  asset_name             TEXT         NOT NULL,
  asset_category         TEXT,        -- 'pipeline', 'terminal', 'upstream', 'storage', 'admin', etc.
  asset_location         TEXT,        -- human-readable; e.g. 'Kitimat, BC'

  -- The six CARVER dimensions, each 1–5.
  criticality            SMALLINT     NOT NULL CHECK (criticality      BETWEEN 1 AND 5),
  accessibility          SMALLINT     NOT NULL CHECK (accessibility    BETWEEN 1 AND 5),
  recuperability         SMALLINT     NOT NULL CHECK (recuperability   BETWEEN 1 AND 5),
  vulnerability          SMALLINT     NOT NULL CHECK (vulnerability    BETWEEN 1 AND 5),
  effect                 SMALLINT     NOT NULL CHECK (effect           BETWEEN 1 AND 5),
  recognizability        SMALLINT     NOT NULL CHECK (recognizability  BETWEEN 1 AND 5),

  -- Generated total — kept on disk so SQL queries can sort/filter
  -- by priority without recomputing the sum.
  total_score            SMALLINT     GENERATED ALWAYS AS (
    criticality + accessibility + recuperability + vulnerability + effect + recognizability
  ) STORED,
  priority_tier          TEXT         GENERATED ALWAYS AS (
    CASE
      WHEN (criticality + accessibility + recuperability + vulnerability + effect + recognizability) >= 24 THEN 'critical'
      WHEN (criticality + accessibility + recuperability + vulnerability + effect + recognizability) >= 18 THEN 'high'
      WHEN (criticality + accessibility + recuperability + vulnerability + effect + recognizability) >= 12 THEN 'medium'
      ELSE 'low'
    END
  ) STORED,

  -- Justification — REQUIRED. CARVER scores without reasoning are
  -- worthless on review. Force the writer to capture WHY each
  -- dimension was rated where it was.
  justification          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Shape: { criticality_reason, accessibility_reason, ..., overall_notes }

  -- Provenance + review state.
  scored_by              TEXT         NOT NULL,                 -- agent call_sign or human user id
  scored_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  validated_at           TIMESTAMPTZ,                           -- NULL = needs expert review
  validated_by           TEXT,                                  -- human analyst who validated
  last_reviewed_at       TIMESTAMPTZ,
  next_review_due        TIMESTAMPTZ,                           -- prompts re-assessment cadence

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One CARVER score per asset per client. Re-scoring updates the
  -- existing row (with last_reviewed_at bumped) rather than
  -- accumulating duplicates. Use asset_carver_score_history (below)
  -- for the audit trail.
  UNIQUE (client_id, asset_name)
);

CREATE INDEX IF NOT EXISTS idx_asset_carver_client_priority
  ON public.asset_carver_scores (client_id, priority_tier, total_score DESC);

CREATE INDEX IF NOT EXISTS idx_asset_carver_validation
  ON public.asset_carver_scores (validated_at NULLS FIRST, next_review_due NULLS FIRST);

-- History table — every UPDATE on asset_carver_scores writes a
-- snapshot here so the analyst review trail is auditable.
CREATE TABLE IF NOT EXISTS public.asset_carver_score_history (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id        UUID         NOT NULL REFERENCES public.asset_carver_scores(id) ON DELETE CASCADE,
  client_id       UUID         NOT NULL,
  asset_name      TEXT         NOT NULL,
  criticality     SMALLINT     NOT NULL,
  accessibility   SMALLINT     NOT NULL,
  recuperability  SMALLINT     NOT NULL,
  vulnerability   SMALLINT     NOT NULL,
  effect          SMALLINT     NOT NULL,
  recognizability SMALLINT     NOT NULL,
  total_score     SMALLINT     NOT NULL,
  justification   JSONB        NOT NULL,
  scored_by       TEXT         NOT NULL,
  scored_at       TIMESTAMPTZ  NOT NULL,
  snapshot_reason TEXT,                       -- 'initial_seed' / 'agent_rescore' / 'human_validation' / 'periodic_review'
  recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carver_history_score
  ON public.asset_carver_score_history (score_id, recorded_at DESC);

-- Trigger: update updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.touch_asset_carver_scores_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS asset_carver_scores_touch ON public.asset_carver_scores;
CREATE TRIGGER asset_carver_scores_touch
  BEFORE UPDATE ON public.asset_carver_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_asset_carver_scores_updated_at();

-- Trigger: snapshot every UPDATE into history.
CREATE OR REPLACE FUNCTION public.snapshot_asset_carver_score_history()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.asset_carver_score_history (
    score_id, client_id, asset_name,
    criticality, accessibility, recuperability, vulnerability, effect, recognizability,
    total_score, justification, scored_by, scored_at, snapshot_reason
  ) VALUES (
    OLD.id, OLD.client_id, OLD.asset_name,
    OLD.criticality, OLD.accessibility, OLD.recuperability, OLD.vulnerability, OLD.effect, OLD.recognizability,
    OLD.total_score, OLD.justification, OLD.scored_by, OLD.scored_at,
    'pre_update_snapshot'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS asset_carver_scores_snapshot ON public.asset_carver_scores;
CREATE TRIGGER asset_carver_scores_snapshot
  BEFORE UPDATE ON public.asset_carver_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_asset_carver_score_history();

-- ─── 2. RLS ─────────────────────────────────────────────────────────
-- Standard tenant scoping: a user can only see CARVER scores for
-- clients they're associated with. Service role bypasses (for agent
-- tool writes).

ALTER TABLE public.asset_carver_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_carver_score_history ENABLE ROW LEVEL SECURITY;

-- Match the existing signals-table RLS pattern: super_admin bypass +
-- tenant-scoped via get_user_accessible_client_ids(). No bespoke
-- user_clients table on this platform.
DROP POLICY IF EXISTS "asset_carver_scores_select" ON public.asset_carver_scores;
CREATE POLICY "asset_carver_scores_select"
  ON public.asset_carver_scores FOR SELECT
  USING (
    is_super_admin(auth.uid())
    OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
  );

DROP POLICY IF EXISTS "asset_carver_scores_super_admin_all" ON public.asset_carver_scores;
CREATE POLICY "asset_carver_scores_super_admin_all"
  ON public.asset_carver_scores FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "asset_carver_scores_analyst_write" ON public.asset_carver_scores;
CREATE POLICY "asset_carver_scores_analyst_write"
  ON public.asset_carver_scores FOR ALL
  USING (
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
  );

DROP POLICY IF EXISTS "asset_carver_score_history_select" ON public.asset_carver_score_history;
CREATE POLICY "asset_carver_score_history_select"
  ON public.asset_carver_score_history FOR SELECT
  USING (
    is_super_admin(auth.uid())
    OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
  );

-- ─── 3. Seed: Petronas Canada CARVER scores ────────────────────────
-- Initial estimates derived from public information (asset size,
-- public reporting, history of protest activity, infrastructure type).
-- validated_at is intentionally NULL — these are seed estimates that
-- a human analyst (or VERIDIAN-TANGO via the score_asset_carver tool)
-- should refine. The platform should NOT operate as if these scores
-- are expert-validated until validated_at is set.

WITH petronas AS (
  SELECT id FROM public.clients WHERE name = 'Petronas Canada' LIMIT 1
)
INSERT INTO public.asset_carver_scores (
  client_id, asset_name, asset_category, asset_location,
  criticality, accessibility, recuperability, vulnerability, effect, recognizability,
  justification, scored_by, scored_at, validated_at
)
SELECT p.id, v.asset_name, v.asset_category, v.asset_location,
       v.criticality, v.accessibility, v.recuperability, v.vulnerability, v.effect, v.recognizability,
       v.justification::jsonb, 'system:initial_seed_2026-05-04', NOW(), NULL
FROM petronas p
CROSS JOIN (VALUES
  -- LNG Canada terminal (Kitimat) — flagship export facility
  ('LNG Canada terminal (Kitimat)', 'lng_terminal', 'Kitimat, BC',
   5, 3, 2, 3, 5, 4,
   '{
     "criticality_reason":     "Largest LNG export facility in Canada (Phase 1: 14 mtpa). Disruption would halt national LNG export and propagate to federal energy policy and trade balance.",
     "accessibility_reason":   "Coastal facility with marine, road, and constrained airspace approaches. Remote (Kitimat) but reachable via Highway 37 and Douglas Channel.",
     "recuperability_reason":  "Cryogenic infrastructure damaged in a major incident requires 12-24 months to restore (modular trains, specialized refrigeration). Score 2 = slow recovery (HIGH attractiveness to attacker).",
     "vulnerability_reason":   "Hardened perimeter and active security; cryogenic systems are inherently somewhat brittle to fire/explosion. Mitigated by depth of security.",
     "effect_reason":          "Cascading effects across BC economy, federal LNG export strategy, indigenous economic partnerships (Haisla Nation 50% Cedar LNG ownership), TC Energy Coastal GasLink utilization.",
     "recognizability_reason": "Globally recognized facility, satellite-visible, named in major media; trivial for a threat actor to identify.",
     "overall_notes":          "INITIAL SEED — needs VERIDIAN-TANGO or human-analyst review. Public-information-based estimates only."
   }'),

  -- Coastal GasLink pipeline — 670km pipeline with protest history
  ('Coastal GasLink pipeline', 'pipeline', 'Northern BC (Dawson Creek to Kitimat)',
   5, 4, 3, 4, 4, 4,
   '{
     "criticality_reason":     "Sole feed gas pipeline to LNG Canada. Without CGL, the entire LNG Canada terminal stops.",
     "accessibility_reason":   "670km linear asset crossing remote wilderness. Multiple historic protest interdictions (Wedzin Kwa, Coyote Camp). Accessible at countless points.",
     "recuperability_reason":  "Pipeline can be repaired in days to weeks for typical damage; longer for major valve station / compressor strikes.",
     "vulnerability_reason":   "Long linear infrastructure is structurally hard to defend at every km. Compressor stations and valve assemblies are concentrated risk points.",
     "effect_reason":          "Disruption cascades directly to LNG Canada operations and to Indigenous community-benefit agreements; high political visibility.",
     "recognizability_reason": "Route is publicly mapped; project is internationally known; no recognition difficulty for a threat actor.",
     "overall_notes":          "INITIAL SEED — Wedzin Kwa / Wetsuweten history of activist interdiction is the dominant accessibility/vulnerability driver."
   }'),

  -- Progress Energy upstream gas assets (Montney) — distributed wells
  ('Progress Energy upstream gas assets (Montney)', 'upstream_gas', 'Montney basin, NE BC',
   4, 3, 3, 3, 3, 3,
   '{
     "criticality_reason":     "Major feedstock for the LNG export chain; loss of significant Montney production would constrain Coastal GasLink throughput.",
     "accessibility_reason":   "Rural NE BC — road-accessible at multiple points; operational access required for production = inherent attack surface.",
     "recuperability_reason":  "Individual wells/pads can be re-completed in weeks; gathering systems repairable in days.",
     "vulnerability_reason":   "Distributed asset class — many wells; attacking any one has limited effect, attacking many is logistically harder.",
     "effect_reason":          "Regional impact; partial production loss is absorbed by inventory and scheduling flexibility.",
     "recognizability_reason": "Industry-known but less publicly visible than the export terminal; specific well sites require some research to identify.",
     "overall_notes":          "INITIAL SEED — distributed-asset CARVER profile typical of upstream operations."
   }'),

  -- Peace Region upstream wells and gathering systems
  ('Peace Region upstream wells and gathering systems', 'upstream_gas', 'Peace Region, NE BC',
   3, 3, 3, 3, 3, 2,
   '{
     "criticality_reason":     "Significant but distributed feedstock contribution; loss of any single component is absorbed by the system.",
     "accessibility_reason":   "Rural; road network and seasonal access; some sites in remote First Nations territory.",
     "recuperability_reason":  "Standard upstream recovery times — wells and gathering systems are routine to restore.",
     "vulnerability_reason":   "Same distributed-asset profile as Montney; baseline industry security.",
     "effect_reason":          "Regional only.",
     "recognizability_reason": "Distributed assets are individually less recognizable than named flagship infrastructure.",
     "overall_notes":          "INITIAL SEED — operational-baseline profile."
   }'),

  -- Prince Rupert Gas Transmission pipeline — proposed/under-construction
  ('Prince Rupert Gas Transmission pipeline', 'pipeline_proposed', 'NW BC corridor',
   3, 3, 3, 4, 3, 3,
   '{
     "criticality_reason":     "Future strategic asset; current criticality is moderate as construction proceeds. Will rise to CRITICAL once operational.",
     "accessibility_reason":   "Construction-phase access along the route; seasonal pattern of protest activity in NW BC.",
     "recuperability_reason":  "Same pipeline-recovery profile as CGL.",
     "vulnerability_reason":   "Linear infrastructure under construction has additional vulnerability surface (work camps, exposed pipe before backfill).",
     "effect_reason":          "Limited cascade today; will scale once tied into Cedar LNG.",
     "recognizability_reason": "Project is publicly known; route under regulatory record.",
     "overall_notes":          "INITIAL SEED — re-score upward when in operation."
   }'),

  -- Cedar LNG (proposed) — proposed floating LNG project
  ('Cedar LNG (proposed)', 'lng_terminal_proposed', 'Kitimat region (proposed)',
   2, 2, 4, 2, 2, 3,
   '{
     "criticality_reason":     "Proposed only. No operational criticality today.",
     "accessibility_reason":   "Pre-construction; accessibility profile not yet established.",
     "recuperability_reason":  "Paper plans / procurement contracts can be re-negotiated; non-physical disruption easier to recover from.",
     "vulnerability_reason":   "Limited physical vulnerability surface today.",
     "effect_reason":          "Indirect — political/regulatory cascade if delayed, but no operational disruption.",
     "recognizability_reason": "Public project; Haisla-led; named in regulatory filings.",
     "overall_notes":          "INITIAL SEED — re-score on construction milestone."
   }'),

  -- PECL BC upstream operations — broad operational umbrella
  ('PECL BC upstream operations', 'upstream_operational', 'BC-wide',
   4, 3, 3, 3, 3, 3,
   '{
     "criticality_reason":     "Aggregated upstream operations underpin the LNG export chain.",
     "accessibility_reason":   "Geographically distributed; standard rural-BC accessibility profile.",
     "recuperability_reason":  "Operational continuity tools and contractor depth allow rapid recovery from local incidents.",
     "vulnerability_reason":   "Distributed-asset profile; cyber/operational tech is a noteworthy non-physical attack surface.",
     "effect_reason":          "Regional cascade.",
     "recognizability_reason": "Industry-known but the PECL umbrella is less recognizable than specific named projects.",
     "overall_notes":          "INITIAL SEED — covers the operational umbrella; specific named assets are scored separately."
   }')
) AS v(
  asset_name, asset_category, asset_location,
  criticality, accessibility, recuperability, vulnerability, effect, recognizability,
  justification
)
ON CONFLICT (client_id, asset_name) DO NOTHING;

-- ─── 4. Knowledge base entry ────────────────────────────────────────
-- Seed an expert_knowledge row so when an agent encounters a CARVER
-- question (via query_expert_knowledge), it receives the formal
-- methodology + scoring rubric + how this platform implements it.

INSERT INTO public.expert_knowledge (
  domain, title, content, source_type, expert_name, citation
)
SELECT
  'physical_security',
  'CARVER target assessment methodology — Fortress implementation',
  'CARVER is a target/asset assessment methodology developed for special operations targeting and adopted for critical infrastructure protection. Each asset is scored 1–5 on six dimensions:

1. CRITICALITY — How critical is this asset to mission success? Higher score = more critical. Consider: dependencies, irreplaceability, immediate operational impact of loss.

2. ACCESSIBILITY — How easily can a threat actor reach the asset? Higher score = more accessible. Consider: physical perimeter, geographic remoteness, transportation routes, security posture.

3. RECUPERABILITY (INVERSE) — How quickly can the asset be restored if damaged? Higher score = SLOWER recovery (more attractive target). Consider: replacement lead time, specialized equipment, supply chain.

4. VULNERABILITY — How exposed is the asset to known attack methods? Higher score = more vulnerable. Consider: structural weaknesses, monitoring coverage, redundancy, attack-surface size.

5. EFFECT — What are the cascading consequences of a successful attack? Higher score = more cascade. Consider: psychological, economic, operational, political second-order effects.

6. RECOGNIZABILITY — How easily can a threat actor identify this asset as a target? Higher score = more recognizable. Consider: public visibility, satellite imagery, news coverage, distinctive features.

TOTAL SCORE = sum, range 6–30.

Priority tiers used by Fortress:
  • CRITICAL (24–30) — top-tier targets, active hardening required
  • HIGH (18–23)     — significant attention warranted
  • MEDIUM (12–17)   — baseline protective measures
  • LOW (6–11)       — opportunistic only

How Fortress implements CARVER:
  • Per-asset scores live in the asset_carver_scores table, scoped per client.
  • Each dimension write requires a written justification (criticality_reason, accessibility_reason, etc.) — scores without reasoning are rejected on review.
  • Total score and priority tier are computed columns (always reflect current dimension values).
  • Initial seed scores are flagged validated_at = NULL until a human analyst (or VERIDIAN-TANGO via the score_asset_carver tool) reviews them.
  • Every UPDATE writes a snapshot to asset_carver_score_history for the audit trail.
  • Tools available to agents: query_carver_scores (read), score_asset_carver (write/update).
  • CARVER is one input to threat assessment, not the whole picture — combine with operational context, current threat actors, and intent-to-harm signals.',
  'manual_seed',
  'agent:VERIDIAN-TANGO',
  'CARVER methodology: U.S. Department of Defense / FEMA critical infrastructure protection literature. Fortress implementation: supabase/migrations/20260504000002_carver_scoring.sql.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.expert_knowledge WHERE title = 'CARVER target assessment methodology — Fortress implementation'
);

COMMIT;

COMMENT ON TABLE public.asset_carver_scores IS
  'Per-asset CARVER (Criticality / Accessibility / Recuperability / Vulnerability / Effect / Recognizability) scores. Each dimension 1-5; total 6-30. validated_at NULL means initial seed pending expert review.';
COMMENT ON TABLE public.asset_carver_score_history IS
  'Append-only audit trail of every CARVER score change. Written by trigger before UPDATE on asset_carver_scores.';
