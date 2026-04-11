-- Fortress Academy: Judgment Training & Decision Validation System
-- Built: 2026-04-10

-- Extend academy_courses with agent assignment
ALTER TABLE academy_courses
  ADD COLUMN IF NOT EXISTS agent_call_sign     TEXT,
  ADD COLUMN IF NOT EXISTS scenario_domain     TEXT,
  ADD COLUMN IF NOT EXISTS content_generated_at TIMESTAMPTZ;

-- Assign agents and domains to existing courses
UPDATE academy_courses SET agent_call_sign = 'VECTOR-TRVL',   scenario_domain = 'travel_security'         WHERE topic_cluster = 'executive_travel_security';
UPDATE academy_courses SET agent_call_sign = 'VERIDIAN-TANGO', scenario_domain = 'osint_privacy'          WHERE topic_cluster = 'digital_privacy_sovereignty';
UPDATE academy_courses SET agent_call_sign = 'WARDEN',         scenario_domain = 'physical_security'      WHERE topic_cluster = 'residential_security';
UPDATE academy_courses SET agent_call_sign = 'WARDEN',         scenario_domain = 'protective_intelligence' WHERE topic_cluster = 'family_protection';
UPDATE academy_courses SET agent_call_sign = 'WRAITH',         scenario_domain = 'reputational_risk'      WHERE topic_cluster = 'reputation_management';
UPDATE academy_courses SET agent_call_sign = 'FORTRESS-GUARD', scenario_domain = 'business_continuity'   WHERE topic_cluster = 'business_continuity';
UPDATE academy_courses SET agent_call_sign = 'AEGIS-CMD',      scenario_domain = 'physical_security'      WHERE topic_cluster = 'physical_protection';
UPDATE academy_courses SET agent_call_sign = 'PEARSON',        scenario_domain = 'financial_security'     WHERE topic_cluster = 'financial_security';
UPDATE academy_courses SET agent_call_sign = 'SENT-2',         scenario_domain = 'cyber_threat_intel'     WHERE topic_cluster = 'cyber_threat_intelligence';
UPDATE academy_courses SET agent_call_sign = 'SHERLOCK',       scenario_domain = 'intelligence_tradecraft' WHERE topic_cluster = 'personal_intelligence_tradecraft';

-- 
CREATE TABLE IF NOT EXISTS academy_scenarios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id               UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  situation_brief         TEXT NOT NULL,
  option_a                JSONB NOT NULL,  -- { text, risk_profile }
  option_b                JSONB NOT NULL,
  option_c                JSONB NOT NULL,
  option_d                JSONB NOT NULL,
  optimal_choice          TEXT NOT NULL CHECK (optimal_choice IN ('a','b','c','d')),
  optimal_rationale       TEXT NOT NULL,
  most_dangerous_choice   TEXT NOT NULL CHECK (most_dangerous_choice IN ('a','b','c','d')),
  most_dangerous_rationale TEXT NOT NULL,
  teaching_points         TEXT[] DEFAULT '{}',
  agent_call_sign         TEXT NOT NULL,
  domain                  TEXT NOT NULL,
  difficulty_level        TEXT DEFAULT 'foundation',
  variant_index           INTEGER DEFAULT 0,  -- 0=pre-test, 1=post-test, 2+=follow-up
  source_belief_ids       UUID[] DEFAULT '{}',
  source_knowledge_ids    UUID[] DEFAULT '{}',
  generated_at            TIMESTAMPTZ DEFAULT now(),
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- 
CREATE TABLE IF NOT EXISTS academy_learner_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intake_answers   JSONB NOT NULL DEFAULT '{}',
  experience_level TEXT,   -- novice / practitioner / expert
  primary_domain   TEXT,
  matched_agent    TEXT,
  matched_tier     TEXT,   -- foundation / advanced / elite
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- 
CREATE TABLE IF NOT EXISTS academy_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_id       UUID NOT NULL REFERENCES academy_scenarios(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL CHECK (stage IN ('pre','post','30day')),
  selected_option   TEXT NOT NULL CHECK (selected_option IN ('a','b','c','d')),
  rationale_optimal   TEXT,
  rationale_dangerous TEXT,
  difficulty_rating INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  base_score        NUMERIC(4,3),   -- 1.0 optimal / 0.5 defensible / 0.0 dangerous
  rationale_score   NUMERIC(4,3),   -- AI-scored 0–1
  total_score       NUMERIC(4,3),   -- 0.65*base + 0.35*rationale
  time_spent_seconds INTEGER,
  completed_at      TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 
CREATE TABLE IF NOT EXISTS academy_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id             UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled','pre_complete','in_training','post_complete','followup_pending','complete')),
  pre_scenario_id       UUID REFERENCES academy_scenarios(id),
  post_scenario_id      UUID REFERENCES academy_scenarios(id),
  agent_call_sign       TEXT,
  pre_score             NUMERIC(4,3),
  post_score            NUMERIC(4,3),
  followup_score        NUMERIC(4,3),
  judgment_delta        NUMERIC(4,3),   -- post_score − pre_score
  retention_delta       NUMERIC(4,3),   -- followup_score − post_score
  enrolled_at           TIMESTAMPTZ DEFAULT now(),
  pre_completed_at      TIMESTAMPTZ,
  post_completed_at     TIMESTAMPTZ,
  followup_due_at       TIMESTAMPTZ,
  followup_completed_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, course_id)
);

-- 
CREATE TABLE IF NOT EXISTS academy_agent_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_call_sign     TEXT NOT NULL,
  domain              TEXT NOT NULL,
  course_id           UUID REFERENCES academy_courses(id),
  learner_count       INTEGER DEFAULT 0,
  avg_judgment_delta  NUMERIC(4,3),
  avg_retention_delta NUMERIC(4,3),
  teaching_score      NUMERIC(4,3),
  last_updated_at     TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_call_sign, domain)
);

-- 
CREATE INDEX IF NOT EXISTS idx_academy_scenarios_course    ON academy_scenarios(course_id);
CREATE INDEX IF NOT EXISTS idx_academy_scenarios_agent     ON academy_scenarios(agent_call_sign);
CREATE INDEX IF NOT EXISTS idx_academy_responses_user      ON academy_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_academy_responses_scenario  ON academy_responses(scenario_id);
CREATE INDEX IF NOT EXISTS idx_academy_progress_user       ON academy_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_academy_progress_followup   ON academy_progress(followup_due_at) WHERE status = 'followup_pending';
CREATE INDEX IF NOT EXISTS idx_academy_agent_scores_agent  ON academy_agent_scores(agent_call_sign);
