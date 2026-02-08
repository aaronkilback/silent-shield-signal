
-- Technology Radar: tracks emerging security technologies and proactive recommendations
CREATE TABLE public.tech_radar_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL, -- 'ai_ml', 'endpoint', 'network', 'cloud', 'physical', 'identity', 'data_protection', 'deception', 'automation'
  technology_name TEXT NOT NULL,
  vendor_landscape TEXT, -- key vendors/products
  maturity_level TEXT NOT NULL DEFAULT 'emerging', -- emerging, early_adopter, mainstream, legacy
  relevance_score NUMERIC(3,2) DEFAULT 0.70, -- how relevant to this org's profile
  urgency TEXT NOT NULL DEFAULT 'monitor', -- adopt_now, evaluate, monitor, watch
  summary TEXT NOT NULL, -- what it is, why it matters
  business_case TEXT, -- ROI/risk reduction argument
  implementation_effort TEXT, -- low, medium, high, enterprise
  estimated_timeline TEXT, -- e.g. "3-6 months", "immediate"
  dependencies TEXT[], -- prerequisites
  risks TEXT[], -- adoption risks
  competing_with TEXT[], -- what legacy tech this replaces
  source_citations TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new', -- new, reviewed, accepted, rejected, in_progress, implemented
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  tenant_id UUID REFERENCES public.tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_tech_radar_category ON public.tech_radar_recommendations(category);
CREATE INDEX idx_tech_radar_urgency ON public.tech_radar_recommendations(urgency);
CREATE INDEX idx_tech_radar_status ON public.tech_radar_recommendations(status);
CREATE INDEX idx_tech_radar_maturity ON public.tech_radar_recommendations(maturity_level);

-- Enable RLS
ALTER TABLE public.tech_radar_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tech radar"
  ON public.tech_radar_recommendations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can update tech radar status"
  ON public.tech_radar_recommendations FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

CREATE POLICY "Service role manages tech radar"
  ON public.tech_radar_recommendations FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
