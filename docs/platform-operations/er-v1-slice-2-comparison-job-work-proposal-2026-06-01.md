# ER v1 Slice 2 — Comparison Job · Work Proposal

**Task #182 (proposed) · 2026-06-01** — work proposal per `feedback_work_proposal_challenge_template`. Follows substrate (Slice 1) prod-applied 2026-06-01T14:11:10Z. **Implementation has not begun.** Awaiting operator GO/NO-GO.

---

## Five-question challenge template

### 1 · What customer-visible capability does the customer gain after this work is complete?

Once this slice ships, the operator can run a **pairwise comparison** between two named entities the operator selects, and receive:

- A **Cluster Confidence class** (UNKNOWN / LOW / MEDIUM / HIGH) using the same predicate-based pattern as Coverage Confidence.
- **Per-axis concrete evidence** the operator can read — not opaque scores:
  - Posting-Time axis: Pearson correlation + most-active-hour overlap (literal: "both active 14:00–22:00 UTC on weekdays").
  - Vocabulary axis: top-N shared distinctive terms (verbatim words/phrases).
  - Source-Class axis: list of source classes each actor appears on + overlap ratio.
- **Honest refusal** when an axis can't be computed (sparse data) — the axis emits "insufficient samples" and does NOT contribute to confidence.
- A **persisted cluster suggestion** row in `actor_clusters` + `actor_cluster_members` with `status='suggested'`, all evidence in `axes_evidence jsonb`, tenant-scoped.

**Critically: the comparison job does not yet surface in Aegis chat or the workspace UI.** That's Slice 3 and Slice 4. This slice produces the **evidence engine** that downstream slices consume.

The customer-visible capability after THIS slice alone is: "an operator can invoke a comparison from a CLI/test harness and see the produced cluster suggestion + evidence in the database, validating that the axis math is correct on real prod data." It is the **necessary precondition** for Slices 3-5; without it those slices have nothing to surface.

### 2 · What dependencies must already exist?

| Dependency | Status |
|---|---|
| `actor_clusters` + `actor_cluster_members` tables | ✅ Prod (Slice 1, 2026-06-01T14:11:10Z) |
| Tenant-match trigger | ✅ Prod (Slice 1) |
| `signals.created_at` + `signals.normalized_text` + `signals.title` | ✅ Long-prod |
| `signals.tenant_id` (for tenant-scoped reads) | ✅ Prod (INC-XTEN containment) |
| `_shared/aegis-coverage-confidence.ts::normalizeSourceClass` | ✅ Prod (Comm Doctrine slim slice) |
| Quarantine filter helpers (`applyAnalystSignalFilter`) | ✅ Prod (Branch 1A) |
| Communication Doctrine template helpers | ✅ Prod (Comm Doctrine slim slice) |
| Flight Recorder write seam | ✅ Prod |

**No new dependencies.** Substrate + existing prod surfaces are sufficient.

### 3 · Are any mandatory foundations missing? (Rework test)

Applied per `feedback_rework_test_for_foundation_work`:

| Concern | Mandatory? | Reasoning |
|---|---|---|
| Writer-side `assertProvenance` seam for the new tables | YES | Already implied by Slice 1's tenant-match trigger, but the comparison job is the **first** code that writes to these tables. Must use the canonical shape (set `tenant_id` from caller's tenant context; trigger fail-closes if absent). |
| Per-axis evidence schema in `axes_evidence` jsonb | YES | If we ship Slice 2 without a stable per-axis evidence shape, Slice 3 (Aegis chat) and Slice 4 (workspace) would need to rebuild downstream consumers when we standardize later. **Define + document the shape in Slice 2; don't defer.** |
| Operator-decision audit row for confirm/reject | NO at Slice 2 | Slice 5 is operator confirm/reject — Slice 2 only ships `status='suggested'`. No decisions get made here. Adding the audit substrate now would be premature; deferred to Slice 5. |
| 74-ownerless-entities writer fix | NO | Per the impact assessment 2026-06-01: ER is fully protected by the trigger. Writer fix is tracked under #19 INC-XTEN sibling sweep as parallel work. |
| `actor_cluster_observations` (a separate observation/run history table) | NO | Speculative substrate per `feedback_no_persistence_without_named_consumer` — no current consumer. The Flight Recorder trace + `axes_evidence` jsonb cover audit needs without a new persistent table. |
| Comparison-frequency telemetry | NO at Slice 2 | Only needed when surface is operator-facing (Slices 3+). Adding before there's a measurable surface is premature. |

**Mandatory foundations missing today: none beyond what this slice itself ships.**

### 4 · What is the expected outcome?

#### Concrete deliverables (Slice 2)
1. New edge function `er-compare-entities` (Deno.serve, tenant-scoped, service-role caller).
2. Three axis modules in `_shared/er-axes/`:
   - `posting-time.ts` — Pearson + most-active-hour-overlap; stub when sparse.
   - `vocabulary.ts` — TF-IDF-derived distinctive terms; intersection; stub when sparse.
   - `source-class.ts` — normalized source classes; overlap; stub when sparse.
3. New shared module `_shared/er-cluster-confidence.ts` — predicate-based aggregation mirroring Coverage Confidence model; emits class + evidence rationale.
4. Writer seam `_shared/er-write-suggestion.ts` — single canonical INSERT into `actor_clusters`/`actor_cluster_members` that sets `tenant_id` from caller, populates `axes_evidence`, fail-closes if tenant unknown.
5. Documented `axes_evidence` jsonb schema (versioned key `v: 1`; documented in module header + this proposal).
6. Unit tests for each axis module (sparse + dense paths; deterministic fixtures).
7. Flight Recorder integration — each comparison logs surface=`er_compare` retrieval trace with returned entity IDs + axes.

#### What this slice does NOT ship
- No Aegis chat integration (Slice 3).
- No workspace UI (Slice 4).
- No operator confirm/reject (Slice 5).
- No Capability Registry status flip (Slice 6).
- No autonomous clustering — the comparison runs only on operator-initiated invocations.
- No mutation of existing entities (does not write tenant_id back; ownerless entities remain ownerless and trigger-blocked).

#### Measurable post-conditions (what we'll prove on staging)
- `er-compare-entities` returns a deterministic result for the same input on staging.
- Comparing two tenant-owned entities produces a row in `actor_clusters`/`actor_cluster_members` with non-empty `axes_evidence` and correct `tenant_id` (matching both members).
- Comparing a tenant-owned entity against one of the 74 ownerless entities produces an **honest refusal** via the trigger (SQLSTATE 23514) — confirms the substrate protection is enforced through this writer.
- Each comparison appears in the Flight Recorder.
- Confidence class distribution across ≥5 staging test pairs is sensible (not all HIGH, not all UNKNOWN — proves the predicate aggregation is calibrated).

### 5 · What are the success criteria?

Aligned with §5 of the design + operator's most-important constraint (*"Optimize for defensible operator-reviewed evidence"*):

| Criterion | How measured |
|---|---|
| **Axes are computable from current prod data** | Each axis runs without external API calls; only reads from `signals` |
| **Evidence is reviewable** | Returned `axes_evidence` jsonb contains concrete claims (correlation numbers, term lists, source-class lists) — not opaque scores |
| **Honest refusal under sparse data** | Axis-level sparseness emits "insufficient samples" in `axes_evidence`; the axis does NOT contribute to confidence; the overall class can still be UNKNOWN |
| **Tenant isolation is non-bypassable** | Cross-tenant comparison attempts fail-closed via the trigger; never produce a misleading suggestion |
| **Provenance is honest** | `axes_evidence` includes Flight Recorder trace IDs + source signal ID lists for each axis's evidence |
| **Comparisons are deterministic** | Same inputs → same outputs on staging (no LLM in the loop for this slice — axes are deterministic math) |

#### Operator usefulness gate (deferred to post-Slice-5)
The full §5 operator usefulness gate (3 staging cluster suggestions, ≥2 decision-useful) cannot be evaluated until Slice 3 + Slice 4 + Slice 5 surface the suggestions. **Slice 2 ships dark — measured against the technical criteria above, not the usefulness gate.**

---

## Challenge question — "What capability does the customer gain after this work is complete?"

**Plain English answer:** Without this slice, Fortress has empty tables that can hold clusters but no way to produce them. With this slice, Fortress can compute "are these two entities likely the same actor?" deterministically from prod data and persist the evidence. The customer cannot yet ASK this question through any UI surface — that's Slice 3+ work — but the engine that answers the question is built, tested, and observable.

If the operator can read the resulting `axes_evidence` jsonb and say "yes, that's the evidence I'd want to see for this judgment", we've built the right thing. If not, Slice 2 needs revision before Slice 3 ships, because Slice 3 surfaces this exact evidence to the customer.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Vocabulary axis is noisy on small samples | Stub-when-sparse <100 words per actor; explicit threshold documented |
| Posting-time correlation is misleading on bot-like accounts (constant cadence) | Document this limitation in the axis module header + emit "constant-cadence detected" rationale when applicable; treat as LOW evidence not HIGH |
| Source-class overlap is trivial when both actors are on a single dominant platform (e.g., both on news) | Stub-when-sparse <2 source classes; require diversity for the axis to contribute |
| Comparison job is expensive on large signal corpora | Per-axis time budget; abort with partial evidence if any axis exceeds budget; record `partial=true` in `axes_evidence` |
| Writer-shape drift between this slice and future slices | Lock `axes_evidence` schema with version `v: 1`; any future schema change requires explicit version bump + migration |
| Trigger fail-closure surfaces as a confusing error during operator-initiated comparison against an ownerless entity | The writer seam should pre-check both entities have `tenant_id`; emit honest refusal at the API layer before the INSERT trips the trigger. Better UX, same containment guarantee. |

---

## What I am asking for

A clean GO / NO-GO / REVISE on:

1. The five-question framing above
2. The deliverables list (§4 Concrete deliverables, items 1-7)
3. The non-deliverables (what this slice explicitly does NOT do)
4. The success criteria (§5 table)
5. The rework-test conclusion (no missing foundations)

On GO → I will:
- Implement on a new branch `feat/er-v1-slice2-comparison`
- Staging-first (deploy `er-compare-entities` + new shared modules to staging)
- Run measurable post-conditions on staging
- Report findings
- Await operator GO for prod deploy
- Merge to main only after prod validation closes

On NO-GO → I will hold and wait for direction.

On REVISE → I will narrow / expand per operator instruction and resubmit before any code is written.

---

## Active state at proposal time

| Item | Status |
|---|---|
| Slice 1 substrate prod | ✅ Applied 2026-06-01T14:11:10Z; T+0 GREEN; T+1h watch in flight (`b6v1gun8w`, fires ~15:11Z) |
| 74 ownerless entities | Operator-accepted Option B 2026-06-01; tracked under #19 INC-XTEN sibling sweep; writers prioritized for parallel fix |
| Capability Registry status for `cross-platform-entity-resolution` | NOT_OPERATIONAL — unchanged until Slice 6 |
| Communication Doctrine slim slice | ✅ Prod (validation closed) |
| T-0 temporal-grounding substrate | ✅ Prod (T+1h closed) |
