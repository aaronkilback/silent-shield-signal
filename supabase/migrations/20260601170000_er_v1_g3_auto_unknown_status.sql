-- G-3 (2026-06-01) — Add 'auto_unknown' to actor_clusters.status enum
--
-- Operator-authorized 2026-06-01 alongside G-1 (tighten MEDIUM) and G-2
-- (evidence-strength language).
--
-- Why: every UNKNOWN comparison was persisting as 'suggested' under the
-- original Slice 1 substrate. At operator-session scale this is fine; at
-- operational scale the operator review queue (Slice 5) would drown in
-- sparse-data noise. The new 'auto_unknown' status preserves audit (the
-- cluster row + axes_evidence + Flight Recorder trace are all retained)
-- while keeping the queue clean — Slice 5+ filters on status='suggested'.
--
-- Doctrines honored (no new doctrine):
--   • Provenance Doctrine — tenant_id still non-NULL; trigger unchanged
--   • Aegis Authority + Memory — cross-tenant trigger unchanged
--   • feedback_maintenance_debt_is_operational_risk — closes pollution path
--
-- Reversible: drop + re-add original constraints if needed.

BEGIN;

ALTER TABLE public.actor_clusters
  DROP CONSTRAINT actor_clusters_status_check,
  DROP CONSTRAINT actor_clusters_resolved_consistency_check;

ALTER TABLE public.actor_clusters
  ADD CONSTRAINT actor_clusters_status_check
    CHECK (status IN ('suggested', 'auto_unknown', 'confirmed', 'rejected', 'superseded')),
  ADD CONSTRAINT actor_clusters_resolved_consistency_check
    CHECK (
      -- 'suggested' and 'auto_unknown' are pre-resolution states
      (status IN ('suggested', 'auto_unknown')
        AND resolved_at IS NULL
        AND resolved_by_user_id IS NULL)
      OR
      -- 'confirmed', 'rejected', 'superseded' are post-resolution
      (status IN ('confirmed', 'rejected', 'superseded')
        AND resolved_at IS NOT NULL)
    );

-- Partial index supporting the Slice 5 operator review queue:
-- "show me clusters that need my review". Excludes 'auto_unknown' implicitly
-- since the partial predicate is status='suggested'.
CREATE INDEX IF NOT EXISTS idx_actor_clusters_review_queue
  ON public.actor_clusters (tenant_id, created_at DESC)
  WHERE status = 'suggested';

COMMENT ON COLUMN public.actor_clusters.status IS
  'Cluster lifecycle. "suggested" = operator review pending. "auto_unknown" '
  '(G-3, 2026-06-01) = system found insufficient evidence; retained for audit '
  'but excluded from operator review queue by default. "confirmed" / '
  '"rejected" / "superseded" = resolved.';

COMMIT;
