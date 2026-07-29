-- Decision Layer R1.0 — aegis_decision_threshold_trace foundation
--
-- ADR: docs/platform-operations/architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md
-- Companion: docs/platform-operations/decision-layer-r1-q-recommendations-2026-05-29.md (v2 with Q5 clarification)
-- Authorization: docs/platform-operations/decision-layer-r1-authorization-sheet-2026-05-29.md (signed 2026-05-29)
--
-- SCOPE OF THIS MIGRATION (per operator-authorized §3 of the authorization sheet):
--   - schema only
--   - RLS (operator-forensic read + service-role write — same idiom as aegis_flight_recorder)
--   - Provenance Doctrine CHECK backstop (tenant_id NOT NULL, non-bypassable)
--   - FK to aegis_request_trace with ON DELETE CASCADE so the 30-day purge cron cascades cleanly
--
-- NOT IN SCOPE (separately gated per the authorization sheet's §4 phased gating):
--   - C1 / C2 / C3 detector logic (R1.1 / R1.2 / R1.3)
--   - Threshold aggregator (R1.4)
--   - Flight Recorder integration into dashboard-ai-assistant (R1.4)
--   - Modification of aegis_trace_replay() to include decision-threshold rows (R1.4+)
--   - Per-tenant feature flag / global kill switch surface (Q9 implementation — R1.4)
--   - Any behavioral effect of any kind
--
-- ZERO BEHAVIORAL EFFECT: the table exists. Nothing writes to it yet. Nothing reads from it yet.
-- Detector code lands in R1.1+, gated separately on operator GO each phase.
--
-- COLUMN DESIGN NOTES:
--   - tenant_id NOT NULL — Decision Frames are tenant-bound by doctrine; global_shared is not
--     a valid asset class for this artifact (per the Decision Layer Doctrine §8 preservation contract
--     against Provenance Doctrine).
--   - c1_candidate_deltas jsonb — array of candidate deltas. Each entry has:
--       { class, evidence_source, evidence_row_ids[], delta_summary,
--         invalidated_commitment_id (uuid|null), materiality_score (the GATE),
--         grounding_state, telemetry { z_score, cadence_vs_28d_median, baseline_window_id } }
--     The structural rule (I1, locked in §B.4 of the recommendations doc): materiality_score
--     is computed from invalidated_commitment_id only; telemetry is alongside, never gating.
--     This separation is enforced by R1.1 detector code (type-level or unit-test assertion),
--     not by the schema — the schema only provides the dedicated telemetry sub-object so
--     conflation has nowhere to hide.
--   - c1_significant_no_commitment jsonb — captures the operator-flagged FN class per §B.1:
--     populated when a candidate scored materially but lacked commitment-linkage (so the gate
--     evaluated false). NULL otherwise. Indexed for the daily watchlist query.
--   - c1_materiality_threshold real — the threshold used at evaluation time. Pinned per
--     evaluator_version so A/B tuning audits can compare versions.
--   - audit_only boolean — row-level persisted state of the Q9 per-tenant flag at evaluation
--     time. The per-tenant flag and global kill switch are themselves separate surfaces (R1.4).
--   - evaluator_version text — R1 build identifier; tuning audits A/B compare against versions.
--
-- REVERSIBILITY (one-statement revert):
--   drop table if exists public.aegis_decision_threshold_trace;
--
-- This migration adds ONLY this table and its indexes/policies. No other surfaces are touched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.aegis_decision_threshold_trace (
  id                              uuid primary key default gen_random_uuid(),

  -- FK to the existing request header so the 30-day purge cron cascades.
  -- Nullable in case a Decision-Layer detector is ever invoked outside a normal
  -- request flow (e.g., scheduled job consuming the same detector library) —
  -- but for R1.0 cold-start, the dash-ai surface always populates this.
  trace_id                        uuid references public.aegis_request_trace(debug_trace_id) on delete cascade,

  -- Tenant scope — PROVENANCE DOCTRINE INVARIANT (non-bypassable at the schema level).
  -- Decision Frames are tenant-bound. global_shared is not a valid asset class for this
  -- artifact. The NOT NULL constraint AND the explicit CHECK below are both required —
  -- the CHECK survives ALTER COLUMN DROP NOT NULL and so guards against future drift.
  tenant_id                       uuid not null,

  -- When the detector ran.
  evaluated_at                    timestamptz not null default now(),

  -- Final aggregator result. The doctrine fire condition is (c1 AND c2 AND c3).
  frame_fires                     boolean not null,

  -- First axis to evaluate false (for diagnosis). NULL if frame_fires=true OR all three
  -- evaluated true.
  short_circuit_axis              text,

  -- ─── C1 (change against working model) ──────────────────────────────────
  c1_asserted                     boolean not null,

  -- Per-candidate delta evaluation. Each entry includes:
  --   { class: 'status'|'trend'|'frame',
  --     evidence_source, evidence_row_ids[],
  --     delta_summary,
  --     invalidated_commitment_id (uuid|null),  -- THE GATE
  --     materiality_score (real, 0..1),
  --     grounding_state ('grounded'),
  --     telemetry { z_score, cadence_vs_28d_median, baseline_window_id }   -- TELEMETRY ONLY
  --   }
  -- Structural rule: materiality_score is computed from invalidated_commitment_id
  -- only. The telemetry sub-object is for observability — never feeds the gate.
  -- Enforced by R1.1 detector code (build-time assertion), not by schema.
  c1_candidate_deltas             jsonb not null default '[]'::jsonb,

  -- Candidates rejected during evaluation. Same shape as c1_candidate_deltas but
  -- with a `rejection_reason` field ('no_commitment_linkage'|'below_materiality'|'inside_baseline'|...).
  c1_rejected_deltas              jsonb not null default '[]'::jsonb,

  -- The materiality threshold used at evaluation time (cold-start: 0.5).
  -- Pinned per evaluator_version for tuning audits.
  c1_materiality_threshold        real not null,

  -- §B.1 watchlist — operator-flagged false-negative class. Populated when at least
  -- one candidate scored materially but every such candidate had
  -- invalidated_commitment_id=null (so c1_asserted=false). Captures:
  --   { top_candidates[], surfaces_consulted[], rejection_reasons[], commitment_inventory_size }
  -- NULL when no significant-no-commitment candidates exist for this evaluation.
  -- Indexed partial below for the daily watchlist query.
  c1_significant_no_commitment    jsonb,

  -- ─── C2 (principal-level stake) ─────────────────────────────────────────
  c2_asserted                     boolean,
  c2_matched_indicator            text,      -- 'personal_exposure'|'strategic_commitment'|...
  c2_rejected_reason              text,      -- 'within_playbook'|'below_severity_floor'|...
  c2_evidence                     jsonb not null default '{}'::jsonb,

  -- ─── C3 (live decision with future deadline) ────────────────────────────
  c3_asserted                     boolean,
  c3_live_decisions               jsonb not null default '[]'::jsonb,
  c3_past_deadline_decisions      jsonb not null default '[]'::jsonb,

  -- ─── Operational metadata ───────────────────────────────────────────────
  evaluator_version               text not null,    -- e.g. 'r1.cold-start.2026-05-29'

  -- Short truncation of the user query (for human review in audit-only period).
  -- Redaction (no PII / no secrets / no raw embeddings) is the seam's responsibility,
  -- mirroring the rest of the Flight Recorder family (per aegis_flight_recorder.sql).
  user_query_summary              text,

  -- Q9: row-level persisted state of the per-tenant audit flag at evaluation time.
  -- The flag surface itself (per-tenant + global kill switch) is R1.4 territory.
  -- For R1.0, this column exists but nothing writes to it yet.
  audit_only                      boolean not null default true,

  created_at                      timestamptz not null default now(),

  -- ─── Provenance Doctrine CHECK backstop (non-bypassable) ────────────────
  -- Survives accidental ALTER COLUMN DROP NOT NULL on tenant_id.
  constraint aegis_decision_threshold_trace_provenance_ck
    check (tenant_id is not null),

  -- ─── Diagnostic integrity ───────────────────────────────────────────────
  -- short_circuit_axis is meaningful only when frame_fires=false AND at least one axis
  -- failed. If frame_fires=true, short_circuit_axis must be NULL.
  constraint aegis_decision_threshold_trace_short_circuit_ck
    check (
      (frame_fires = true and short_circuit_axis is null)
      or (frame_fires = false)
    ),

  -- short_circuit_axis values constrained to known axes.
  constraint aegis_decision_threshold_trace_axis_values_ck
    check (
      short_circuit_axis is null
      or short_circuit_axis in ('c1', 'c2', 'c3', 'timeout')
    )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes
--    Tuned for the §7 7-day audit review queries + the §B.1 watchlist.
-- ─────────────────────────────────────────────────────────────────────────────

-- Primary operator-review access pattern: per-tenant, most-recent-first.
create index if not exists idx_aegis_dec_thresh_tenant_evaluated
  on public.aegis_decision_threshold_trace (tenant_id, evaluated_at desc);

-- Trace correlation (join to the request header).
create index if not exists idx_aegis_dec_thresh_trace_id
  on public.aegis_decision_threshold_trace (trace_id)
  where trace_id is not null;

-- "All firings" view (rare-event, indexed for fast scan).
create index if not exists idx_aegis_dec_thresh_fires_evaluated
  on public.aegis_decision_threshold_trace (frame_fires, evaluated_at desc);

-- Short-circuit distribution (tuning audit — which axis blocks most often).
create index if not exists idx_aegis_dec_thresh_short_circuit
  on public.aegis_decision_threshold_trace (short_circuit_axis, evaluated_at desc)
  where short_circuit_axis is not null;

-- Evaluator-version A/B comparison.
create index if not exists idx_aegis_dec_thresh_eval_version
  on public.aegis_decision_threshold_trace (evaluator_version, evaluated_at desc);

-- §B.1 watchlist — daily operator review of "significant signal without commitment to invalidate."
-- Partial index keeps it small (only the watchlist-relevant rows).
create index if not exists idx_aegis_dec_thresh_b1_watchlist
  on public.aegis_decision_threshold_trace (tenant_id, evaluated_at desc)
  where c1_significant_no_commitment is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — same idiom as the rest of the Flight Recorder family
--    (operator-forensic read via super_admin; service-role write).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.aegis_decision_threshold_trace enable row level security;

drop policy if exists "aegis_decision_threshold_trace operator read" on public.aegis_decision_threshold_trace;
create policy "aegis_decision_threshold_trace operator read"
  on public.aegis_decision_threshold_trace
  for select
  to authenticated
  using (is_super_admin(auth.uid()));

drop policy if exists "aegis_decision_threshold_trace service manage" on public.aegis_decision_threshold_trace;
create policy "aegis_decision_threshold_trace service manage"
  on public.aegis_decision_threshold_trace
  for all
  to service_role
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Documentation comments
-- ─────────────────────────────────────────────────────────────────────────────
comment on table public.aegis_decision_threshold_trace is
  'Decision Layer R1.0 — threshold-detection observability surface. '
  'Per-evaluation record of (C1 ∧ C2 ∧ C3) decision-frame threshold detection. '
  'Audit-only at deployment; behavioral effect (R2 consuming the output) gated on R1.7 promotion. '
  'See ADR decision-layer-r1-threshold-detection-2026-05-29.md.';

comment on column public.aegis_decision_threshold_trace.tenant_id is
  'Tenant scope. NOT NULL — Provenance Doctrine invariant for tenant-bound artifacts. '
  'Decision Frames are tenant-bound; global_shared is not a valid asset class for this artifact.';

comment on column public.aegis_decision_threshold_trace.c1_candidate_deltas is
  'Candidate deltas evaluated for materiality. Each entry includes invalidated_commitment_id (the GATE) '
  'AND a telemetry sub-object (z_score, cadence_vs_28d_median). Per Q5 clarification (locked invariants '
  'I1 + I2): the gate is commitment-linkage only; telemetry is observability-only and must never feed '
  'materiality_score. R1.1 detector code enforces this via build-time assertion (§B.4 watchlist).';

comment on column public.aegis_decision_threshold_trace.c1_significant_no_commitment is
  '§B.1 audit watchlist — operator-flagged false-negative class. Populated when at least one candidate '
  'scored materially but every such candidate lacked commitment-linkage (so the gate evaluated false). '
  'NULL otherwise. Tracked daily during the 7-day audit period.';

comment on column public.aegis_decision_threshold_trace.audit_only is
  'Row-level persisted state of the Q9 per-tenant audit flag at evaluation time. '
  'When true, R1.4 aggregator emits the trace but does NOT feed downstream (R2) consumers. '
  'The flag surface itself is R1.4 territory.';

comment on column public.aegis_decision_threshold_trace.evaluator_version is
  'R1 build identifier (e.g. r1.cold-start.2026-05-29). Tuning audits A/B-compare across versions.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reversibility
-- ─────────────────────────────────────────────────────────────────────────────
-- The 30-day purge cron on public.aegis_request_trace (from 20260527170000_aegis_flight_recorder.sql)
-- cascades through trace_id (ON DELETE CASCADE) — no separate purge function needed.
-- aegis_trace_replay() is INTENTIONALLY NOT modified by this migration; replay integration is R1.4.
--
-- Full revert (single statement):
--   drop table if exists public.aegis_decision_threshold_trace;
