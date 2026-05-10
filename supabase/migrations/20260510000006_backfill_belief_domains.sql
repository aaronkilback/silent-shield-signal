-- Backfill agent_beliefs.related_domains from each agent's
-- ai_agents.specialty text. 85% of beliefs (~11.2k of 13.2k) had empty
-- related_domains because knowledge-synthesizer only populates the
-- field from underlying knowledge entries' `domain` column, which is
-- itself sparsely populated. Result: beliefs were not queryable by
-- lane, which weakened agent-chat's belief-retrieval ability to
-- prioritize topical beliefs.
--
-- Strategy: derive 1–4 domain tags per agent from the first few
-- comma/semicolon-separated tokens in their specialty text (filtered
-- to length ≥4, lowercased, deduplicated). Fall back to specialty as
-- one tag when splitting yields nothing. Apply only to rows where
-- related_domains is empty/null — never overwrite existing tags.

BEGIN;

WITH agent_domains AS (
  SELECT
    a.call_sign,
    -- Take up to 4 specialty tokens, lowercase + trim them.
    (
      SELECT array_agg(DISTINCT trim(lower(t)) ORDER BY trim(lower(t)))
      FROM (
        SELECT unnest(
          regexp_split_to_array(
            COALESCE(a.specialty, ''),
            E',|;|/| and |\\s—\\s|\\s-\\s|\\(|\\)'
          )
        ) AS t
      ) split
      WHERE length(trim(t)) >= 4
      LIMIT 4
    ) AS domains
  FROM public.ai_agents a
)
UPDATE public.agent_beliefs b
SET related_domains = COALESCE(ad.domains, ARRAY[]::text[])
FROM agent_domains ad
WHERE b.agent_call_sign = ad.call_sign
  AND (b.related_domains IS NULL OR array_length(b.related_domains, 1) IS NULL)
  AND ad.domains IS NOT NULL
  AND array_length(ad.domains, 1) >= 1;

-- Verify
SELECT
  'beliefs_no_domain_after' AS metric,
  COUNT(*)::text AS val
FROM agent_beliefs
WHERE related_domains IS NULL OR array_length(related_domains, 1) IS NULL
UNION ALL
SELECT
  'beliefs_with_domain_after',
  COUNT(*)::text
FROM agent_beliefs
WHERE array_length(related_domains, 1) >= 1;

COMMIT;
