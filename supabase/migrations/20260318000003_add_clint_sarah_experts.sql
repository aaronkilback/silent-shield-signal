-- Add Clint Emerson and Sarah Adams as expert profiles

INSERT INTO public.expert_profiles (
  name, title, bio, expertise_domains,
  linkedin_url, youtube_channel_url, podcast_rss_url, website_url,
  relevant_agent_call_signs, notes
) VALUES
(
  'Clint Emerson',
  'Retired Navy SEAL, Survival & Evasion Expert',
  'Retired Navy SEAL (20 years) with service in SEAL Team 6 (DEVGRU). Author of 100 Deadly Skills and Escape the Wolf. Expert in SERE (Survival, Evasion, Resistance, Escape), unconventional survival, personal protection, evasion tradecraft, and real-world self-defence. His LinkedIn posts contain high-value tactical content for personal security practitioners.',
  ARRAY['physical_security', 'executive_protection', 'crisis_management', 'travel_security', 'counter_terrorism'],
  'https://www.linkedin.com/in/clintonemerson/',
  'https://www.youtube.com/@ClintEmerson',
  NULL,
  'https://clintemerson.com',
  ARRAY['AEGIS-CMD', '0DAY', 'BRAVO-1', 'VECTOR-TRVL', 'CRUCIBLE'],
  'SERE doctrine, evasion and escape techniques, unconventional survival, personal protection for VIPs, situational awareness frameworks, ambush survival, vehicle escape. His "100 Deadly Skills" series is a foundational text for physical red team and EP practitioners.'
),
(
  'Sarah Adams',
  'National Security Expert & Intelligence Analyst',
  'National security expert with background in intelligence and threat analysis. Known for commentary on counterterrorism, foreign policy, and intelligence community operations. Active on LinkedIn with analytical posts on current threat landscape, intelligence tradecraft, and national security policy.',
  ARRAY['threat_intelligence', 'counter_terrorism', 'geopolitical', 'crisis_management'],
  'https://www.linkedin.com/in/sarahadams/',
  NULL,
  NULL,
  NULL,
  ARRAY['RYAN-INTEL', 'INSIDE-EYE', 'MATRIX', 'GLOBE-SAGE'],
  'Intelligence analysis, counterterrorism, geopolitical threat assessment, national security policy. LinkedIn posts contain current threat landscape analysis and intelligence methodology insights.'
)
ON CONFLICT DO NOTHING;
