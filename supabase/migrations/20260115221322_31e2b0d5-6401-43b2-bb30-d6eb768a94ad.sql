-- Create table for configurable executive tone rules
CREATE TABLE public.executive_tone_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_phrase TEXT NOT NULL,
  replacement_phrase TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create table for tracking report evidence sources
CREATE TABLE public.report_evidence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'signal', 'incident', 'archival_document', 'external_news', 'cyber_log', 'intel_platform'
  source_id TEXT, -- ID of the source record
  source_title TEXT,
  source_url TEXT, -- external URL if applicable
  internal_url TEXT, -- Fortress internal link
  timestamp TIMESTAMPTZ,
  confidence_score NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create table for incident classification rationale (for the Unknown Incident tracking)
CREATE TABLE public.incident_classification_rationale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid REFERENCES public.incidents(id) ON DELETE CASCADE,
  classification TEXT NOT NULL, -- 'P1', 'P2', 'P3', 'P4'
  system_of_origin TEXT NOT NULL, -- 'cyber', 'physical', 'intel_platform', 'social_media', 'internal_report'
  rationale TEXT NOT NULL,
  classified_by TEXT, -- 'auto' or user_id
  classified_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(incident_id)
);

-- Create table for report action items with ownership
CREATE TABLE public.report_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  action_description TEXT NOT NULL,
  owner_id uuid REFERENCES public.profiles(id),
  owner_role TEXT, -- fallback if no specific owner
  deadline TIMESTAMPTZ,
  first_update_due TIMESTAMPTZ,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  related_incident_id uuid REFERENCES public.incidents(id),
  related_signal_id uuid REFERENCES public.signals(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.executive_tone_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_classification_rationale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_action_items ENABLE ROW LEVEL SECURITY;

-- Policies for executive_tone_rules (admins can manage, all authenticated can read)
CREATE POLICY "Anyone can view tone rules"
  ON public.executive_tone_rules
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage tone rules"
  ON public.executive_tone_rules
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Policies for report_evidence_sources
CREATE POLICY "Authenticated users can view evidence sources"
  ON public.report_evidence_sources
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert evidence sources"
  ON public.report_evidence_sources
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policies for incident_classification_rationale
CREATE POLICY "Authenticated users can view classification rationale"
  ON public.incident_classification_rationale
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Analysts can manage classification rationale"
  ON public.incident_classification_rationale
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analyst') OR 
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'super_admin')
  );

-- Policies for report_action_items
CREATE POLICY "Authenticated users can view action items"
  ON public.report_action_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Analysts can manage action items"
  ON public.report_action_items
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analyst') OR 
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'super_admin')
  );

-- Add triggers for updated_at
CREATE TRIGGER update_executive_tone_rules_updated_at
  BEFORE UPDATE ON public.executive_tone_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_report_action_items_updated_at
  BEFORE UPDATE ON public.report_action_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default tone rules (operator to executive language)
INSERT INTO public.executive_tone_rules (original_phrase, replacement_phrase, category) VALUES
  ('HUMINT opportunity to penetrate', 'Consider targeted source development', 'collection'),
  ('penetrate the organization', 'establish liaison channels', 'collection'),
  ('deploy assets', 'allocate dedicated resources', 'operations'),
  ('terminate engagement', 'conclude assessment activities', 'operations'),
  ('hostile actor', 'threat actor', 'terminology'),
  ('enemy personnel', 'persons of interest', 'terminology'),
  ('neutralize threat', 'mitigate identified risk', 'response'),
  ('eliminate vulnerability', 'address security gap', 'response'),
  ('operational security breach', 'information security incident', 'incidents'),
  ('compromise detected', 'unauthorized access identified', 'incidents'),
  ('target acquisition', 'subject identification', 'collection'),
  ('surveillance operation', 'monitoring activity', 'collection'),
  ('black ops', 'sensitive operations', 'classification'),
  ('wet work', 'physical security intervention', 'classification');