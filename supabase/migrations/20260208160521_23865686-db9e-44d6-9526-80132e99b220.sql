
-- Knowledge sources tracking - what external expertise has been ingested
CREATE TABLE public.world_knowledge_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'framework', -- framework, advisory, standard, research, threat_intel
  source_url TEXT,
  domain TEXT NOT NULL, -- e.g. 'physical_security', 'cyber', 'executive_protection', 'crisis_management'
  last_ingested_at TIMESTAMPTZ,
  ingestion_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  refresh_interval_hours INTEGER DEFAULT 168, -- weekly default
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expert knowledge entries - distilled expertise from world-class sources
CREATE TABLE public.expert_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES public.world_knowledge_sources(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  subdomain TEXT,
  knowledge_type TEXT NOT NULL DEFAULT 'best_practice', -- best_practice, framework, methodology, case_study, threat_pattern, standard
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  applicability_tags TEXT[] DEFAULT '{}',
  confidence_score NUMERIC(3,2) DEFAULT 0.80,
  citation TEXT,
  is_active BOOLEAN DEFAULT true,
  last_validated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast domain lookups
CREATE INDEX idx_expert_knowledge_domain ON public.expert_knowledge(domain, subdomain);
CREATE INDEX idx_expert_knowledge_type ON public.expert_knowledge(knowledge_type);
CREATE INDEX idx_expert_knowledge_tags ON public.expert_knowledge USING GIN(applicability_tags);
CREATE INDEX idx_world_knowledge_sources_domain ON public.world_knowledge_sources(domain);

-- Enable RLS
ALTER TABLE public.world_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_knowledge ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read knowledge
CREATE POLICY "Authenticated users can read knowledge sources"
  ON public.world_knowledge_sources FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read expert knowledge"
  ON public.expert_knowledge FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role handles inserts/updates (edge functions)
CREATE POLICY "Service role manages knowledge sources"
  ON public.world_knowledge_sources FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role manages expert knowledge"
  ON public.expert_knowledge FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Seed core knowledge sources
INSERT INTO public.world_knowledge_sources (source_name, source_type, source_url, domain, refresh_interval_hours) VALUES
  ('MITRE ATT&CK Framework', 'framework', 'https://attack.mitre.org', 'cyber', 168),
  ('CISA Known Exploited Vulnerabilities', 'advisory', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', 'cyber', 24),
  ('NIST Cybersecurity Framework', 'standard', 'https://www.nist.gov/cyberframework', 'cyber', 720),
  ('ASIS International Standards', 'standard', 'https://www.asisonline.org', 'physical_security', 720),
  ('OWASP Top 10', 'framework', 'https://owasp.org/www-project-top-ten/', 'cyber', 720),
  ('Executive Protection Institute', 'research', 'https://www.personalprotection.com', 'executive_protection', 720),
  ('FEMA Emergency Management', 'framework', 'https://www.fema.gov', 'crisis_management', 168),
  ('World Economic Forum Global Risks', 'research', 'https://www.weforum.org/reports/global-risks-report', 'geopolitical', 720),
  ('Interpol Threat Assessments', 'threat_intel', 'https://www.interpol.int', 'threat_intelligence', 168),
  ('Global Terrorism Database', 'research', 'https://www.start.umd.edu/gtd/', 'threat_intelligence', 720),
  ('OSAC Travel Advisories', 'advisory', 'https://www.osac.gov', 'travel_security', 24),
  ('ISO 27001/27002', 'standard', 'https://www.iso.org/isoiec-27001-information-security.html', 'cyber', 720),
  ('NIST SP 800-53', 'standard', 'https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final', 'compliance', 720),
  ('Crisis Management Body of Knowledge', 'framework', 'https://www.drii.org', 'crisis_management', 720),
  ('Surveillance Detection Methodology', 'methodology', null, 'executive_protection', 720);
