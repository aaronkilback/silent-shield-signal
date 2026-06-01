-- Entity Resolution v1 — substrate-first slice
--
-- Authorization: Operator GO 2026-06-01 (D1-D6 approved); design in
--   docs/platform-operations/entity-resolution-v1-design-2026-06-01.md
--
-- Doctrines honored (existing, no new doctrine introduced):
--   • Provenance Doctrine — non-NULL tenant_id + CHECK constraint + FK
--   • Aegis Authority + Memory — cross-tenant cluster linking forbidden by tenant-match trigger
--   • Tenant Isolation — RLS via tenant_users linkage
--   • Communication Doctrine — substrate-only; reader/writer slices ship later and inherit the
--     ratified Coverage Confidence + Capability Registry framing automatically
--
-- BEHAVIORAL CHANGE: ZERO at apply time.
--   • No writer references these tables yet.
--   • No reader references these tables yet.
--   • Capability Registry status flip (NOT_OPERATIONAL → PARTIAL) ships with the writer/reader
--     slice, not this substrate slice.
--
-- Mirror of C-0 + T-0 pattern: pure DDL substrate; staging-first apply; operator-gated prod
-- promotion after burn-in.
--
-- Rework-test invariants locked here (per ER v1 design §6):
--   • N-way cluster shape (cluster_members is many-to-one with clusters) — pairwise-only would
--     force Cycling rebuild
--   • Time-axis on member rows (first_seen_at) — Cycling time-filter needs this
--   • Per-axis evidence storage (axes_evidence jsonb) — Cycling cites cluster evidence
--   • Operator confirmation state (clusters.status + resolved_*) — Cycling needs confirmed vs
--     suggested distinction
--   • Tenant ownership at every row + tenant-match trigger — Provenance + Aegis Authority
--   • Foreign-key cascade to entities — when an entity is deleted, its cluster memberships go
--     with it (referential integrity)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §A — actor_clusters: one row per logical actor cluster (suggested or resolved)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.actor_clusters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'suggested',
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by_user_id uuid REFERENCES auth.users(id),
  resolution_note     text,
  summary_text        text,

  -- Status lifecycle: suggested → (confirmed | rejected | superseded)
  CONSTRAINT actor_clusters_status_check
    CHECK (status IN ('suggested', 'confirmed', 'rejected', 'superseded')),

  -- Resolved consistency: 'suggested' rows have NULL resolved_*; resolved rows have non-NULL
  -- resolved_at (resolved_by_user_id may still be NULL for system-superseded clusters).
  CONSTRAINT actor_clusters_resolved_consistency_check
    CHECK (
      (status = 'suggested' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
      OR (status <> 'suggested' AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_actor_clusters_tenant         ON public.actor_clusters(tenant_id);
CREATE INDEX idx_actor_clusters_status_tenant  ON public.actor_clusters(tenant_id, status);
CREATE INDEX idx_actor_clusters_created        ON public.actor_clusters(tenant_id, created_at DESC);

COMMENT ON TABLE public.actor_clusters IS
  'Entity Resolution v1 substrate (2026-06-01). One row per actor cluster. '
  'Tenant-owned per Provenance Doctrine. Status lifecycle: suggested → confirmed/rejected/superseded. '
  'Operator confirmation persists via resolved_at + resolved_by_user_id + resolution_note. '
  'No autonomous clustering at this layer (D1 approved 2026-06-01 — operator-initiated only at v1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- §B — actor_cluster_members: N-way membership with time-axis + per-axis evidence
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.actor_cluster_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      uuid NOT NULL REFERENCES public.actor_clusters(id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'candidate',
  first_seen_at   timestamptz NOT NULL,
  axes_evidence   jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_at        timestamptz NOT NULL DEFAULT now(),

  -- Role: anchor (operator-known good actor) | candidate (system-suggested similar account)
  CONSTRAINT actor_cluster_members_role_check
    CHECK (role IN ('anchor', 'candidate')),

  -- An entity can only be in a given cluster once
  CONSTRAINT actor_cluster_members_cluster_entity_unique
    UNIQUE (cluster_id, entity_id)
);

CREATE INDEX idx_acm_cluster                  ON public.actor_cluster_members(cluster_id);
CREATE INDEX idx_acm_entity                   ON public.actor_cluster_members(entity_id);
CREATE INDEX idx_acm_cluster_first_seen       ON public.actor_cluster_members(cluster_id, first_seen_at);

COMMENT ON TABLE public.actor_cluster_members IS
  'Entity Resolution v1 — N-way cluster membership. Each row links an entity to a cluster. '
  'first_seen_at carries the time-axis required by future Account Cycling Detection (no rework). '
  'axes_evidence stores per-axis evidence (posting-time fingerprint, vocabulary overlap, source-class '
  'overlap) in jsonb for operator audit + cluster-confidence derivation. '
  'role: anchor (operator-known good actor) vs candidate (system-suggested similar account).';

-- ─────────────────────────────────────────────────────────────────────────────
-- §C — tenant-match trigger: non-bypassable Provenance backstop
--
-- Even under service-role writes (which bypass RLS), this trigger enforces that the parent
-- cluster's tenant matches the member entity's tenant. Cross-tenant ER linking would be
-- a doctrinal violation (Aegis Authority + Memory). NULL entity tenant_id is rejected
-- fail-closed (per Provenance Doctrine — no ownerless artifacts).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.actor_cluster_member_tenant_match()
RETURNS trigger AS $$
DECLARE
  v_cluster_tenant_id uuid;
  v_entity_tenant_id  uuid;
BEGIN
  SELECT tenant_id INTO v_cluster_tenant_id
    FROM public.actor_clusters WHERE id = NEW.cluster_id;
  SELECT tenant_id INTO v_entity_tenant_id
    FROM public.entities WHERE id = NEW.entity_id;

  IF v_cluster_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'actor_cluster_members.cluster_id % refers to non-existent cluster (tenant_id NULL)',
      NEW.cluster_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_entity_tenant_id IS NULL THEN
    -- Per Provenance Doctrine: ownerless entities cannot be members of a cluster.
    -- This intentionally rejects the known INC-XTEN-class gap (entities.tenant_id nullable
    -- in legacy data) — ER refuses to participate in tenant-ambiguous linking.
    RAISE EXCEPTION
      'actor_cluster_members.entity_id % refers to entity with NULL tenant_id (Provenance Doctrine violation)',
      NEW.entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_cluster_tenant_id <> v_entity_tenant_id THEN
    RAISE EXCEPTION
      'actor_cluster_members tenant mismatch: cluster tenant_id=% but entity tenant_id=% (Aegis Authority + Memory: cross-tenant clustering forbidden)',
      v_cluster_tenant_id, v_entity_tenant_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_actor_cluster_members_tenant_match
BEFORE INSERT OR UPDATE OF cluster_id, entity_id ON public.actor_cluster_members
FOR EACH ROW EXECUTE FUNCTION public.actor_cluster_member_tenant_match();

COMMENT ON FUNCTION public.actor_cluster_member_tenant_match() IS
  'Provenance Doctrine + Aegis Authority + Memory non-bypassable backstop. '
  'Prevents cross-tenant ER linking even under service-role writes. '
  'Fires BEFORE INSERT OR UPDATE on actor_cluster_members. '
  'Three rejections: (a) NULL cluster tenant_id, (b) NULL entity tenant_id (ownerless — '
  'Provenance violation), (c) cluster.tenant_id <> entity.tenant_id (Aegis Authority cross-tenant '
  'violation). All raise SQLSTATE 23514 (check_violation).';

-- ─────────────────────────────────────────────────────────────────────────────
-- §D — Row-Level Security (tenant-scoped reads; writes are service-role-only until writer ships)
--
-- SELECT policies allow authenticated users to read rows whose owning tenant they belong to.
-- INSERT / UPDATE / DELETE are intentionally NOT exposed via RLS at this substrate layer —
-- service-role-only writes until the writer slice ships with explicit assertProvenance +
-- operator-action audit (per the Communication Doctrine + Capability Registry pattern that
-- shipped to prod 2026-06-01).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.actor_clusters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actor_cluster_members  ENABLE ROW LEVEL SECURITY;

CREATE POLICY actor_clusters_select_tenant
  ON public.actor_clusters
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY actor_cluster_members_select_tenant
  ON public.actor_cluster_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.actor_clusters c
      WHERE c.id = actor_cluster_members.cluster_id
        AND c.tenant_id IN (
          SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
        )
    )
  );

COMMIT;
