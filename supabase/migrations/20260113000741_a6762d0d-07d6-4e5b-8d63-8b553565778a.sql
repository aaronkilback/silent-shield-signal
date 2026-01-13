-- Create RoE mode enum
CREATE TYPE public.roe_mode AS ENUM ('STRICT', 'STANDARD');

-- Create audience enum
CREATE TYPE public.roe_audience AS ENUM ('INTERNAL', 'CLIENT');

-- Create classification enum
CREATE TYPE public.roe_classification AS ENUM ('PUBLIC', 'CONFIDENTIAL', 'RESTRICTED');

-- Create validation status enum
CREATE TYPE public.validation_status AS ENUM ('PASS', 'WARN', 'FAIL', 'PENDING');

-- Create rules_of_engagement table for global and reusable RoE configs
CREATE TABLE public.rules_of_engagement (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_global_default BOOLEAN DEFAULT false,
  
  -- Core settings
  version TEXT DEFAULT '1.0',
  mode roe_mode NOT NULL DEFAULT 'STRICT',
  audience roe_audience NOT NULL DEFAULT 'INTERNAL',
  classification roe_classification NOT NULL DEFAULT 'CONFIDENTIAL',
  
  -- Allowed domains
  allowed_domains JSONB DEFAULT '{
    "operational": ["security-planning", "risk-briefing", "incident-response", "OSINT-summary"],
    "prohibited": ["illegal-activity", "weapons-construction", "malware", "personal-medical-advice", "legal-advice-as-final"]
  }'::jsonb,
  
  -- Permissions
  permissions JSONB DEFAULT '{
    "can_read_sources": true,
    "can_use_external_web": false,
    "can_access_client_profile": true,
    "can_access_internal_logs": true,
    "can_generate_recommendations": true,
    "can_issue_directives": false,
    "can_schedule_actions": false,
    "can_export_reports": true
  }'::jsonb,
  
  -- Data sources
  data_sources JSONB DEFAULT '{
    "allowed": ["user_input", "uploaded_files", "internal_incident_logs", "approved_osint_feeds"],
    "blocked": ["unverified_social", "anonymous_tips_without_validation"],
    "source_priority_order": ["internal_incident_logs", "uploaded_files", "approved_osint_feeds", "user_input"],
    "require_source_tags": true
  }'::jsonb,
  
  -- Evidence policy
  evidence_policy JSONB DEFAULT '{
    "require_evidence_for_claims": true,
    "minimum_evidence_for_client_output": "E2",
    "minimum_evidence_for_directive": "E3",
    "forbidden_without_evidence": [
      "attribution of specific actors",
      "specific timeline certainty",
      "specific technical root cause"
    ]
  }'::jsonb,
  
  -- Uncertainty protocol
  uncertainty_protocol JSONB DEFAULT '{
    "required_fields": ["confidence", "assumptions", "unknowns", "next_validation_steps"],
    "confidence_scale": ["LOW", "MEDIUM", "HIGH"],
    "must_label_hypotheses": true,
    "ban_phrases": ["definitely", "guaranteed", "certainly", "100%"],
    "required_phrases_when_uncertain": ["Based on available inputs", "Hypothesis", "To confirm"]
  }'::jsonb,
  
  -- Scope control
  scope_control JSONB DEFAULT '{
    "must_stay_within_mission_objective": true,
    "must_not_invent_data": true,
    "must_not_claim_actions_taken": true,
    "must_not_claim_access_to_systems_not_enabled": true,
    "if_missing_key_info_then": "PROVIDE_OPTIONS_WITH_ASSUMPTIONS",
    "max_questions_before_proceeding": 3
  }'::jsonb,
  
  -- Escalation rules
  escalation_rules JSONB DEFAULT '{
    "escalate_if": [
      "classification == RESTRICTED and audience == CLIENT",
      "request exceeds permissions",
      "request requires legal/medical/regulated advice",
      "evidence below minimum thresholds"
    ],
    "escalation_path": ["TaskForceLeader", "HumanOperator"]
  }'::jsonb,
  
  -- Output constraints
  output_constraints JSONB DEFAULT '{
    "must_use_templates": true,
    "allowed_output_types": ["briefing", "checklist", "risk_snapshot", "incident_playbook", "exec_summary"],
    "blocked_output_types": ["code_for_intrusion", "harmful_instructions", "fabricated_citations"],
    "max_length_client": 800,
    "must_include_action_owners": true,
    "must_include_time_horizon": true
  }'::jsonb,
  
  -- Validation gate
  validation_gate JSONB DEFAULT '{
    "run_before_publish": true,
    "checks": ["ScopeCheck", "EvidenceCheck", "UncertaintyFieldsCheck", "PermissionsCheck", "NoInventedFactsCheck"],
    "on_fail": "REVISE_AND_FLAG"
  }'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

ALTER TABLE public.rules_of_engagement ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view RoE"
ON public.rules_of_engagement
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage RoE"
ON public.rules_of_engagement
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'super_admin')
  )
);

-- Add RoE reference to agents
ALTER TABLE public.ai_agents ADD COLUMN roe_id UUID REFERENCES public.rules_of_engagement(id);

-- Add RoE reference and validation status to missions
ALTER TABLE public.task_force_missions 
ADD COLUMN roe_id UUID REFERENCES public.rules_of_engagement(id),
ADD COLUMN roe_override JSONB,
ADD COLUMN validation_status validation_status DEFAULT 'PENDING',
ADD COLUMN validation_errors TEXT[];

-- Add validation fields to contributions
ALTER TABLE public.task_force_contributions
ADD COLUMN evidence_level TEXT DEFAULT 'E0' CHECK (evidence_level IN ('E0', 'E1', 'E2', 'E3', 'E4')),
ADD COLUMN validation_status validation_status DEFAULT 'PENDING',
ADD COLUMN validation_errors TEXT[],
ADD COLUMN unknowns TEXT[],
ADD COLUMN next_validation_steps TEXT[];

-- Insert default global RoE
INSERT INTO public.rules_of_engagement (name, description, is_global_default)
VALUES (
  'Default STRICT RoE',
  'Global default Rules of Engagement - STRICT mode with evidence requirements',
  true
);

-- Add trigger
CREATE TRIGGER update_roe_updated_at
BEFORE UPDATE ON public.rules_of_engagement
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();