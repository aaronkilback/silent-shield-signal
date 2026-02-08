
-- =============================================
-- TIER 5-7: Autonomous Operations Infrastructure
-- =============================================

-- Tier 5: Scheduled Briefings
CREATE TABLE public.scheduled_briefings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  briefing_type TEXT NOT NULL DEFAULT 'daily_summary',
  schedule_cron TEXT NOT NULL DEFAULT '0 6 * * *',
  recipient_user_ids UUID[] NOT NULL DEFAULT '{}',
  recipient_emails TEXT[] DEFAULT '{}',
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view scheduled briefings"
  ON public.scheduled_briefings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage scheduled briefings"
  ON public.scheduled_briefings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

-- Tier 5: Auto-Escalation Rules
CREATE TABLE public.auto_escalation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'threshold',
  conditions JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '{}',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_escalation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view escalation rules"
  ON public.auto_escalation_rules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage escalation rules"
  ON public.auto_escalation_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

-- Tier 5: Autonomous Actions Log
CREATE TABLE public.autonomous_actions_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_type TEXT NOT NULL,
  action_details JSONB NOT NULL DEFAULT '{}',
  trigger_source TEXT NOT NULL,
  trigger_id UUID,
  result JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.autonomous_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view actions log"
  ON public.autonomous_actions_log FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service can insert actions log"
  ON public.autonomous_actions_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- Tier 6: Investigation Playbooks
CREATE TABLE public.investigation_playbooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  threat_category TEXT NOT NULL,
  severity_level TEXT NOT NULL DEFAULT 'medium',
  source_type TEXT NOT NULL DEFAULT 'ai_generated',
  source_investigation_ids UUID[] DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  countermeasures JSONB DEFAULT '[]',
  success_metrics JSONB DEFAULT '{}',
  times_used INTEGER NOT NULL DEFAULT 0,
  effectiveness_score NUMERIC(4,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  model_version TEXT DEFAULT 'v1',
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view playbooks"
  ON public.investigation_playbooks FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage playbooks"
  ON public.investigation_playbooks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

-- Tier 7: Simulation Scenarios
CREATE TABLE public.simulation_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'what_if',
  target_entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  target_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  results JSONB DEFAULT '{}',
  risk_score NUMERIC(5,2),
  confidence_score NUMERIC(5,2),
  attack_chains JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  run_by UUID REFERENCES public.profiles(id),
  model_used TEXT DEFAULT 'gpt-5.2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.simulation_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view simulations"
  ON public.simulation_scenarios FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create simulations"
  ON public.simulation_scenarios FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage simulations"
  ON public.simulation_scenarios FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()) OR run_by = auth.uid());

-- Add updated_at triggers
CREATE TRIGGER update_scheduled_briefings_updated_at
  BEFORE UPDATE ON public.scheduled_briefings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_auto_escalation_rules_updated_at
  BEFORE UPDATE ON public.auto_escalation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_investigation_playbooks_updated_at
  BEFORE UPDATE ON public.investigation_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
