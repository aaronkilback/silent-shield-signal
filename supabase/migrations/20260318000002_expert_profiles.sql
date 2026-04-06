-- Expert Profiles
-- Tracks individual human experts (retired SEALs, CIA analysts, security practitioners)
-- and their content channels so agents can continuously learn from them.

CREATE TABLE public.expert_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,                                    -- e.g. "Retired Navy SEAL", "Former CIA Operations Officer"
  bio TEXT,
  expertise_domains TEXT[] DEFAULT ARRAY[]::TEXT[],  -- maps to expert_knowledge.domain values
  youtube_channel_url TEXT,
  youtube_channel_id TEXT,
  podcast_rss_url TEXT,
  podcast_name TEXT,
  linkedin_url TEXT,
  website_url TEXT,
  twitter_handle TEXT,
  relevant_agent_call_signs TEXT[] DEFAULT ARRAY[]::TEXT[], -- which agents should ingest this expert
  is_active BOOLEAN DEFAULT true,
  last_ingested_at TIMESTAMP WITH TIME ZONE,
  ingestion_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view expert profiles"
ON public.expert_profiles FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage expert profiles"
ON public.expert_profiles FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'super_admin')
  )
);

-- Link expert_knowledge entries to a specific expert profile
ALTER TABLE public.expert_knowledge
ADD COLUMN IF NOT EXISTS expert_profile_id UUID REFERENCES public.expert_profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS expert_name TEXT,
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS media_type TEXT; -- 'youtube', 'podcast', 'article', 'linkedin', 'framework'

CREATE INDEX idx_expert_knowledge_expert_profile ON public.expert_knowledge(expert_profile_id);
CREATE INDEX idx_expert_profiles_active ON public.expert_profiles(is_active) WHERE is_active = true;

-- Seed some well-known experts across domains
INSERT INTO public.expert_profiles (name, title, expertise_domains, youtube_channel_url, podcast_rss_url, linkedin_url, relevant_agent_call_signs, notes) VALUES
(
  'Jocko Willink',
  'Retired Navy SEAL Commander, Leadership & Discipline Expert',
  ARRAY['leadership', 'crisis_management', 'executive_protection', 'physical_security'],
  'https://www.youtube.com/@JockoWillink',
  'https://feeds.podcastmirror.com/jocko-podcast',
  'https://www.linkedin.com/in/jockowillink/',
  ARRAY['AEGIS-CMD', 'BRAVO-1', 'CRUCIBLE'],
  'Extreme Ownership methodology, SEAL Team leadership, combat decision-making under pressure'
),
(
  'Mike Baker',
  'Former CIA Operations Officer, Intelligence Expert',
  ARRAY['threat_intelligence', 'geopolitical', 'counter_terrorism', 'insider_threat'],
  'https://www.youtube.com/@MikeBakerCIA',
  NULL,
  NULL,
  ARRAY['RYAN-INTEL', 'INSIDE-EYE', 'MATRIX'],
  'CIA clandestine operations, intelligence analysis, global threat landscape'
),
(
  'Andrew Bustamante',
  'Former CIA Intelligence Officer, EverydaySpy',
  ARRAY['threat_intelligence', 'executive_protection', 'fraud_social_engineering', 'counter_terrorism'],
  'https://www.youtube.com/@EverydaySpy',
  'https://feeds.buzzsprout.com/1079012.rss',
  'https://www.linkedin.com/in/andrewbustamante/',
  ARRAY['RYAN-INTEL', 'SPECTER', 'INSIDE-EYE'],
  'CIA tradecraft for civilians, surveillance detection, social engineering awareness, spy skills for everyday security'
),
(
  'Marcus Luttrell',
  'Retired Navy SEAL, Lone Survivor, Resilience Expert',
  ARRAY['crisis_management', 'physical_security', 'executive_protection'],
  'https://www.youtube.com/@MarcusLuttrell',
  NULL,
  NULL,
  ARRAY['AEGIS-CMD', 'BRAVO-1'],
  'Combat survival, resilience under fire, mission continuation under extreme duress'
),
(
  'Kevin Mitnick',
  'World''s Most Famous Hacker, Social Engineering Expert (legacy)',
  ARRAY['cyber', 'fraud_social_engineering', 'insider_threat'],
  NULL,
  NULL,
  NULL,
  ARRAY['0DAY', 'INSIDE-EYE'],
  'Social engineering methodology, human hacking, security awareness — archived knowledge from the most influential hacker turned security consultant'
),
(
  'Chris Hadnagy',
  'Social Engineering Expert, Human Hacking',
  ARRAY['fraud_social_engineering', 'cyber', 'insider_threat'],
  'https://www.youtube.com/@SocialEngineerLLC',
  'https://www.social-engineer.org/feed/',
  'https://www.linkedin.com/in/chrishadnagy/',
  ARRAY['0DAY', 'INSIDE-EYE', 'ECHO-WATCH'],
  'Social Engineering Village (DEF CON), SE framework, pretexting methodology, OSINT-to-attack chains'
),
(
  'Ryan Montgomery',
  '0day CTF, Elite Ethical Hacker',
  ARRAY['cyber', 'physical_security'],
  'https://www.youtube.com/@0dayCTF',
  NULL,
  'https://www.linkedin.com/in/ryanmontgomery0day/',
  ARRAY['0DAY'],
  'Direct persona model for 0DAY agent — offensive security, vulnerability research, ethical hacking methodology'
),
(
  'Scott Schober',
  'Cybersecurity Expert, Author of Hacked Again',
  ARRAY['cyber', 'fraud_social_engineering'],
  'https://www.youtube.com/@ScottSchober',
  NULL,
  'https://www.linkedin.com/in/scottschober/',
  ARRAY['0DAY', 'ECHO-WATCH'],
  'Wireless security, cybercrime, small business cybersecurity'
),
(
  'Tony Anscombe',
  'ESET Chief Security Evangelist',
  ARRAY['cyber', 'threat_intelligence'],
  NULL,
  NULL,
  'https://www.linkedin.com/in/tonyanscombe/',
  ARRAY['0DAY', 'RYAN-INTEL'],
  'Current threat landscape, consumer and enterprise cybersecurity, malware trends'
),
(
  'Gavin de Becker',
  'Threat Assessment & Intuition Expert, Author of The Gift of Fear',
  ARRAY['executive_protection', 'threat_intelligence', 'physical_security'],
  NULL,
  NULL,
  NULL,
  ARRAY['RYAN-INTEL', 'SPECTER', 'AEGIS-CMD'],
  'Pre-incident indicators, threat assessment methodology, intuition as a survival tool, stalking and violence prediction'
);
