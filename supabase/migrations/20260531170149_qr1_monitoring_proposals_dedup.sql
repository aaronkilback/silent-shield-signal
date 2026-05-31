-- QR1: monitoring_proposals duplicate generation gate
-- Doctrine: Address Generation Before Approval
-- Pre-flight: docs/platform-operations/qr1-pre-flight-2026-05-31.md (Task #126)
-- Source diagnosis: docs/platform-operations/queue-generation-reduction-assessment-2026-05-31.md (Task #123)
--
-- Effect:
--   1. Adds 'superseded' to monitoring_proposals.status allowed values
--   2. Marks pre-existing duplicate rows as 'superseded' via deterministic ranking
--   3. Creates partial unique index on (client_id, proposal_type, normalized_value)
--      WHERE status IN ('pending','applied') to prevent future duplicate inserts
--
-- Coupled writer update (in same PR):
--   - supabase/functions/generate-monitoring-proposals/index.ts handles 23505
--   - supabase/functions/process-stored-document/index.ts handles 23505 (bulk → per-row)

BEGIN;

-- §A — Add 'superseded' status value
ALTER TABLE public.monitoring_proposals
  DROP CONSTRAINT monitoring_proposals_status_check;

ALTER TABLE public.monitoring_proposals
  ADD CONSTRAINT monitoring_proposals_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'applied'::text, 'expired'::text, 'superseded'::text]));

-- §B — Mark excess duplicates as 'superseded'
--   Deterministic ranking per (client_id, proposal_type, normalized_value):
--     1. 'applied' status wins over 'pending'
--     2. Higher confidence wins (NULLS LAST)
--     3. Older row wins (created_at ASC)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, proposal_type,
        LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g')))
      ORDER BY
        CASE status WHEN 'applied' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        confidence DESC NULLS LAST,
        created_at ASC
    ) AS rn
  FROM public.monitoring_proposals
  WHERE status IN ('pending', 'applied')
)
UPDATE public.monitoring_proposals
SET
  status = 'superseded',
  reviewed_at = NOW(),
  reasoning = COALESCE(reasoning || ' | ', '') ||
              '[QR1 dedup 2026-05-31: superseded by duplicate kept via deterministic ranking]'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- §C — Verify cleanup completed; abort migration if any duplicates remain
DO $$
DECLARE
  remaining_dups int;
BEGIN
  SELECT (COUNT(*) - COUNT(DISTINCT (client_id, proposal_type, normalized_value))) INTO remaining_dups
  FROM (
    SELECT
      client_id,
      proposal_type,
      LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g'))) AS normalized_value
    FROM public.monitoring_proposals
    WHERE status IN ('pending', 'applied')
  ) AS s;

  IF remaining_dups > 0 THEN
    RAISE EXCEPTION 'QR1 cleanup incomplete: % duplicate rows still violate constraint. Aborting migration.', remaining_dups;
  END IF;
END $$;

-- §D — Create the partial unique index
CREATE UNIQUE INDEX monitoring_proposals_dedup_idx
ON public.monitoring_proposals (
  client_id,
  proposal_type,
  (LOWER(TRIM(regexp_replace(proposed_value, '\s+'::text, ' '::text, 'g'::text))))
)
WHERE status IN ('pending', 'applied');

COMMENT ON INDEX public.monitoring_proposals_dedup_idx IS
  'QR1 dedup gate (2026-05-31). Prevents duplicate (client_id, proposal_type, normalized_value) inserts while status is pending or applied. Doctrine: Address Generation Before Approval. Pre-flight: docs/platform-operations/qr1-pre-flight-2026-05-31.md.';

COMMIT;
