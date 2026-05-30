# Backlog Item — Feedback Loop Restoration (Path A)

**Created:** 2026-05-30  
**Status:** BACKLOG — diagnosed, scoped, not authorized for execution.  
**Classification:** B — Moderate workstream (see remediation assessment).

## Summary

- **Detection functioning.** 146 signals across 11 source categories in the last 7 days; signal-ingest pipeline is alive end-to-end.
- **Feedback capture functioning.** `feedback_events` 267 rows in 30d, `implicit_feedback_events` 136 rows in 30d; analyst dismissals and confirmations are being recorded.
- **Path B (apply-feedback-to-agent) functioning.** 83 `self_improvement_log` rows in 30d; operator feedback reaches the originating agent's `system_prompt` via the parallel queue path.
- **Path A (learning_profiles statistical learning) broken.** Lifetime row count = 0 since the Phase 1 tenant-scoping cutover. The `upsertLearningProfile` writer in `process-feedback/index.ts:621-625` omits `tenant_id`, which the schema requires `NOT NULL`. INSERT fails with `23502`; the outer `try/catch` silently swallows the error.
- **Net effect on detection today:** statistical pattern accumulation per-source / per-category / per-rejection-reason / adaptive-threshold is **frozen at baseline**. Path B (per-agent prompt evolution) compensates partially but does not replace the statistical-gate adaptation.

## Remediation status

- **Causal map:** complete (diagnostic deliverable 2026-05-30).
- **Remediation assessment:** complete (B-class). Documents blast radius, complexity, risk, expected outcome.
- **Schema changes:** none required. Schema is already correct (`tenant_id NOT NULL`, `UNIQUE (tenant_id, profile_type)`, FK to tenants).
- **Backfill:** not required. Forward-only acceptable. Snapshot restore not advisable (35 archived rows predate tenant_id column).
- **Affects Path B:** no. Independent surfaces.

## Safe repair shape (recorded; not authorized)

Bundled writer + consumer tenant-scoping in a single deploy to avoid CQ1 transient cross-tenant pattern bleed:

1. `process-feedback/index.ts` — feedback_events `.select('id, tenant_id')`; thread `tenantId` through 8 `update<Object>Learning` functions + ~13 call sites of `upsertLearningProfile`; helper signature accepts `tenantId` and adds it to both SELECT-existing filter and INSERT payload.
2. `_shared/signal-relevance-scorer.ts` — add `.eq('tenant_id', currentTenantId)` to learning_profiles reads.
3. `ingest-signal/index.ts` — same filter on its learning_profiles read.
4. Audit ~5 remaining consumers for tenant_id filter on reads.
5. Pre-flight: audit `aggregate-implicit-feedback`, `aggregate-global-learnings`, `agent-self-learning` for the same tenant_id-omission pattern in any parallel writers.
6. Diff estimate: ~80–120 lines across ~3 primary files + ~5–8 consumer audit touch-ups.

## What this is NOT

- Not a CQ1 violation in present prod (table is empty → no current cross-tenant exposure surface).
- Not a regression of Path B.
- Not gated by schema or migration work.
- Not a Decision Layer / R1.x dependency.

## Pre-execution requirements (when authorized)

- Bundled deploy (writer + consumer in one PR / one Cloudflare deploy) to eliminate transient cross-tenant read window.
- Functional test: synthetic two-tenant fixture write+read roundtrip proving isolation.
- Telemetry watch post-deploy: signal admission/rejection rate per-tenant for 7–14 days to detect over-tightening or over-loosening excursions.
- Watchdog clears `learning_profiles has not updated in 48h` alarm within hours of deploy.

## Decision context

Deferred 2026-05-30 by operator. Mission priorities at time of deferral:

1. C.4 capability complete.
2. C.4 adoption window active (4 weeks; closes ~2026-06-27).
3. Detection confirmed healthy (Detection Health Assessment 2026-05-30).
4. Path B providing partial learning coverage; statistical-gate freeze does not threaten present-day detection.

Re-evaluate priority after:
- C.4 adoption window closes and §11 inventory re-run completes.
- §11 outcome (S1/S2/S3 success vs F1/F2 failure) is known.
- Operator decides whether to continue Option C → R1.1 OR pivot toward platform-health items including Path A restoration.

## Dependencies

- **Independent of** C.4 adoption observation, R1.1 detector work, Report Generator Standardization (separate backlog item).
- **Sequencing consideration:** if FLR ships during the C.4 adoption window, signal-volume shifts from Path A reactivation may complicate adoption-signal attribution. Cleaner sequencing: defer FLR until after §11 re-run captures clean adoption baseline.
- **Held adjacent:** INC-LEARN-CONTAM containment on `expert_knowledge`, `global_learning_insights`, `agent_beliefs` is separate work and remains frozen. This backlog item does not lift that freeze.
