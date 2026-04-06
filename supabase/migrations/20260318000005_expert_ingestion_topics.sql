-- Add ingestion_topics to expert_profiles: specific books, frameworks, and subject areas
-- to query independently for deeper knowledge extraction.
ALTER TABLE public.expert_profiles
ADD COLUMN IF NOT EXISTS ingestion_topics TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Populate Clint Emerson's topics — each one becomes a dedicated Perplexity query
UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  '100 Deadly Skills book survival evasion escape tactics',
  'Escape the Wolf book hostile environment survival methodology',
  'SERE survival evasion resistance escape Navy SEAL training doctrine',
  'situational awareness threat detection civilian self-protection framework',
  'executive protection advance work protective detail methodology',
  'vehicle escape and evasion ambush survival techniques',
  'improvised tools and field-expedient solutions hostile environments',
  'close quarters combat self defense principles SEAL Team 6',
  'surveillance detection counter-surveillance techniques',
  'emergency first aid field medicine tactical combat casualty care',
  'digital privacy OPSEC personal security for civilians',
  'travel security hostile environment preparation protocols'
] WHERE name = 'Clint Emerson';

-- Populate Sarah Adams' topics
UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'counterterrorism analysis threat assessment methodology intelligence',
  'national security geopolitical risk assessment framework',
  'intelligence community operations tradecraft analysis',
  'terrorism radicalization indicators behavioral analysis',
  'foreign policy security implications threat actor profiling',
  'intelligence analysis cognitive bias mitigation analytical methods',
  'open source intelligence OSINT national security applications',
  'crisis response national security decision making under uncertainty'
] WHERE name = 'Sarah Adams'
  AND linkedin_url = 'https://www.linkedin.com/in/sarahadams/';

-- Also seed topics for other pre-loaded experts
UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'Extreme Ownership leadership principles Navy SEAL combat lessons',
  'Jocko Willink Default Aggressive leadership framework decision making',
  'Discipline Equals Freedom daily routine mental toughness principles',
  'Dichotomy of Leadership balance leadership traits military application',
  'SEAL Team task unit leadership mission planning debrief methodology',
  'combat stress management decision making under fire leadership',
  'after action review debrief culture continuous improvement military'
] WHERE name = 'Jocko Willink';

UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'CIA operations tradecraft clandestine intelligence collection methods',
  'intelligence analysis structured analytic techniques ACH methodology',
  'counterterrorism threat assessment current global threat landscape',
  'foreign intelligence service tradecraft detection awareness',
  'geopolitical risk corporate security implications',
  'source handling human intelligence HUMINT methodology'
] WHERE name = 'Mike Baker';

UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'EverydaySpy CIA tradecraft for civilians surveillance detection',
  'Andrew Bustamante spy skills situational awareness framework',
  'social engineering pretext construction resistance techniques',
  'hostile surveillance recognition and counter-surveillance methods',
  'intelligence community mindset analytical framework for civilians',
  'personal security OPSEC digital privacy tradecraft for professionals'
] WHERE name = 'Andrew Bustamante';

UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'The Gift of Fear threat assessment pre-incident indicators',
  'Gavin de Becker intuition survival signal recognition methodology',
  'stalking prediction domestic violence threat assessment',
  'workplace violence prediction behavioral indicators',
  'threat assessment violence prediction methodology MOSAIC',
  'fear versus worry rational threat perception training'
] WHERE name = 'Gavin de Becker';

UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'social engineering attack methodology human hacking framework',
  'Chris Hadnagy pretexting vishing phishing physical social engineering',
  'Social Engineering Village DEF CON techniques and findings',
  'SE Framework structured social engineering assessment methodology',
  'elicitation techniques information gathering without detection',
  'security awareness training social engineering resistance'
] WHERE name = 'Chris Hadnagy';

UPDATE public.expert_profiles SET ingestion_topics = ARRAY[
  'Ryan Montgomery 0day ethical hacking penetration testing methodology',
  'offensive security vulnerability research responsible disclosure',
  'network penetration testing attack chain methodology',
  'web application exploitation OWASP top 10 attack techniques',
  'social engineering cyber attack chain physical to cyber integration'
] WHERE name = 'Ryan Montgomery';
