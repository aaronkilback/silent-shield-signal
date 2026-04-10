-- =============================================================================
-- Archive orphaned "Security Intelligence: Petronas" signals
-- Date: 2026-04-09
--
-- These 14 signals were inserted directly by osint-web-search on April 8 at
-- 21:57–22:35 UTC, bypassing the ingest-signal pipeline. As a result they have:
--   - no client_id (not linked to any client)
--   - no confidence or composite_confidence score
--   - no received_at timestamp
--   - no rule_category / rule_tags
--   - status 'new' (never triaged)
--
-- Content analysis: all 14 are Google search results from petronas.com (the
-- global PETRONAS website) and Wikipedia — routine corporate PR, not threat
-- intelligence. The AI relevance gate in ingest-signal would have rejected or
-- significantly downgraded most of these.
--
-- Fix going forward: osint-web-search now routes through ingest-signal (same
-- deployment). These historical signals are archived as low-quality/orphaned.
-- =============================================================================

UPDATE public.signals
SET
  status = 'archived',
  triage_override = 'review',
  deletion_reason = 'Orphaned OSINT signal: bypassed ingest-signal pipeline, no client association, source is entity''s own corporate website (petronas.com). Re-routed through ingest-signal going forward.',
  updated_at = NOW()
WHERE id IN (
  '0cdd93a9-ad98-4d1d-af91-613c1fe78ec0',
  '5cb7250e-cb49-4800-9309-12f0b0a88278',
  'b2b875bf-9eea-4f89-8879-8ae2b69682f7',
  'f924d399-b469-401d-a123-99ecdfe2ee7d',
  '9b507fdc-30d5-45d4-aff4-9188126cc944',
  '73e66279-f088-4ccc-bf5c-68326651c891',
  '3b18e43c-98ec-4b7e-abcb-f715f313ca56',
  'c869e91e-84be-4ef9-880c-4002d487fe78',
  '92ba5958-1631-4de9-94af-9e2cde0f3102',
  '3668f110-e03d-4fd9-be45-353b43823209',
  '12bc98fb-22c9-41a8-9d60-5eb9436b3f2d',
  '51653cb2-720a-441a-86ac-b3330b25fb76',
  '1d41a851-1928-4e7f-bb30-94aa344ec043',
  '7c36f05d-a046-408c-87bb-c06e5dde38fd'
)
AND title = 'Security Intelligence: Petronas'
AND status = 'new';
