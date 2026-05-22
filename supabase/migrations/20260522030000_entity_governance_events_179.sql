-- #179 — Entity governance audit table extension
--
-- Adds:
--   1. `bypass_metadata jsonb` — captures audit context for operator-promoted
--      verdicts and super_admin cross-tenant bypasses
--   2. `operator_promoted` to the verdict CHECK allowlist — supports the
--      explicit-operator-promotion path (writes directly to `entities` with
--      mandatory audit trail) per #179 doctrine
--
-- Per Aaron H-1 decisions:
--   - No CRITICAL writer may directly write entities without governance
--   - operator_promoted is the audited exception path for explicit operator action
--   - bypass_metadata is mandatory when verdict='operator_promoted'

BEGIN;

ALTER TABLE public.entity_governance_events
  ADD COLUMN IF NOT EXISTS bypass_metadata jsonb;

COMMENT ON COLUMN public.entity_governance_events.bypass_metadata IS
  '#179 — Audit metadata for verdicts that bypass the standard human-review gate. Mandatory for operator_promoted verdicts. Shape: {bypass_type, operator_id, reason, ...}.';

-- Drop and recreate verdict CHECK to include operator_promoted.
-- The CHECK constraint name follows the convention from #171's CREATE TABLE.
ALTER TABLE public.entity_governance_events
  DROP CONSTRAINT IF EXISTS entity_governance_events_verdict_check;

ALTER TABLE public.entity_governance_events
  ADD CONSTRAINT entity_governance_events_verdict_check
  CHECK (verdict IN ('auto_link','suggestion_queue','auto_reject','operator_promoted'));

-- Enforce: operator_promoted requires bypass_metadata
ALTER TABLE public.entity_governance_events
  ADD CONSTRAINT entity_governance_events_operator_promoted_requires_audit
  CHECK (
    verdict <> 'operator_promoted'
    OR (bypass_metadata IS NOT NULL AND bypass_metadata ? 'operator_id' AND bypass_metadata ? 'reason')
  );

COMMENT ON CONSTRAINT entity_governance_events_operator_promoted_requires_audit
  ON public.entity_governance_events IS
  '#179 — operator_promoted verdicts MUST carry bypass_metadata with operator_id + reason. Enforces the audit trail at the schema level.';

COMMIT;
