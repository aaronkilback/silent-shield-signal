-- Add richer context to Sarah Adams so Perplexity search can disambiguate her
-- from the many other "Sarah Adams" on LinkedIn.
UPDATE public.expert_profiles
SET
  title = 'National Security Expert, Former Intelligence Analyst, Security Commentator',
  bio = 'National security expert and former intelligence analyst. Known for commentary on terrorism, geopolitical risk, and intelligence community operations. Active LinkedIn presence sharing threat assessments and intelligence analysis methodology. Appears on news media as a national security commentator.',
  notes = 'Focus search on: national security, counterterrorism analysis, intelligence community, geopolitical threat assessment. LinkedIn slug: sarahadams — use to disambiguate from other Sarah Adams.'
WHERE name = 'Sarah Adams'
  AND linkedin_url = 'https://www.linkedin.com/in/sarahadams/';
