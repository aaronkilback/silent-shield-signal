# ADR — Aegis: Phase Shift to Operational Intelligence

**Status:** DRAFT (proposed 2026-05-28) — pending operator ratification.
**Supersedes:** none. **Extends:** every Aegis ADR ratified to date.
**Scope:** sets priority order, hard constraints, and workstream definitions for the next phase of Aegis work. Does **not** authorize implementation of any specific workstream; each workstream's design ADR (or build PR) must be raised + ratified separately.

---

## 1. Phase declaration

The platform is transitioning from:

> **Hardened AI infrastructure** (tenant isolation · provenance · replay · observability · parity oracle · ontology reconciliation · graph traversal seams)

to:

> **Operational intelligence system** (operator-visible cognition · analyst-usable graph · confidence/provenance surfacing · operational reasoning by Aegis).

The transition is justified by the cumulative state of foundation work:

| Foundation | Status | Reference |
|---|---|---|
| Tenant isolation (read + write seams) | Ratified, enforced | Aegis Authority & Memory Doctrine; INC-OMCR fix |
| Provenance Doctrine | Ratified, DB-enforced | `provenance-contract.md` |
| Flight Recorder (runtime replay) | Operational | `aegis-flight-recorder.md` |
| Parity oracle | Operational | `aegis-entity-parity-probe` |
| Ontology reconciliation | Ratified | `aegis-operational-ontology.md` |
| Canonical entity model (schema) | Staging-validated, **prod hold** | G3 (PR #36) |
| Unified graph traversal seam | On main | `_shared/tenant-entity-graph.ts` |

The foundation is sufficient to begin building operator-visible cognition **without** further infrastructure shift. Continuing to harden infrastructure now would yield diminishing returns vs. surfacing what the foundation already supports.

## 2. Hard constraints (carried forward, non-negotiable)

These are not new — they are the operator-given constraints that must be preserved through every workstream below. Any new workstream that violates one of these is invalid and must be reworked.

### 2.1 Recommendation / Approval / Execution separation

> Execution is intentionally delayed until operational cognition and graph trust mature further. Maintain strict separation between recommendation, approval, and execution.

Concretely, in this phase Aegis and the operator UIs may:

- **Recommend** — surface a proposed action, with provenance and confidence.
- **Approve** — accept the recommendation into a reviewed/queued state (operator decision).
- **Execute** — apply the side-effect to durable state.

Nothing built in this phase may collapse two of those into a single user action. No "Aegis decided + applied" path. No auto-collapse, no auto-monitor-enable, no auto-relationship-write, no auto-merge.

### 2.2 No auto-collapse of unresolved-conflict clusters

Inherited from G3. Canonical collapse is operator-only via `operator_elect_canonical`. The canonical review workflow must surface, not act.

### 2.3 Tenant-safe traversal only

All operator-visible cognition must use the certified retrieval seam (`tenantRetrieve()` for tenant work, `entityGraph()` for tenant-scoped traversal, `globalLearning()` for L2 only). No new code path may read cross-tenant or shared global stores outside the audited Aegis Ops retrieval seam.

### 2.4 Provenance-backed traversal only

Every operationally-displayed claim must carry sufficient provenance for the operator to verify it: source record id(s), source surface (signal · scan · report · relationship), timestamp, and (when applicable) corroboration set. Vague aggregate claims without traceability are banned.

### 2.5 Fail-closed grounding defaults

When a recommendation lacks the grounding to support it (no retrieval trace, no provenance), it must be **withheld**, not weakened. The Aegis Flight Recorder grounding fail-closed default applies: unknown/unavailable rather than guess.

### 2.6 Operator-forensic visibility preserved

Every operationally-meaningful action recommended/approved by an operator must be replayable. Flight Recorder coverage extends to operator review workflows.

## 3. Workstream definitions

The four workstreams below are **definitions only** — what each workstream is and what it explicitly is not. Their internal designs (data shapes, UI mechanics, RPC surfaces) must be raised as separate ADRs/PRs and ratified before build.

### A. Canonical review workflows

**Goal:** make G3's `pending_review` / `unresolved_conflict` clusters operator-actionable and make canonical lineage operator-visible.

**In scope:**
- Review queue UI listing clusters with `canonical_classification IN ('pending_review','unresolved_conflict')`, with their blockers visible.
- Operator elect/reject UX → calls `operator_elect_canonical` / `operator_reject_collapse` (already DB-side).
- Provenance display per cluster (what triggered review · what the blockers are · which member is the proposed canonical and why).
- Canonical lineage view (for any entity: am I a canonical · what's my cluster · who elected · when).

**Out of scope (for this workstream):**
- Auto-collapse on any signal (operator action required by definition).
- Cross-tenant lineage merging (forbidden by 2.3).
- Synthetic entity creation outside the existing entities table.

**Dependencies:** G3 in prod. Workstream A cannot ship without it.

### B. Intelligence graph operationalization

**Goal:** make the existing `entityGraph()` traversal seam operator-visible and analyst-usable.

**In scope:**
- Graph visualization (entities · edges · scan/report/signal density per entity) bounded to the operator's current tenant view.
- Relationship evolution display (when an edge appeared · provenance · confidence).
- Provenance/confidence display on every visualized node and edge.
- Investigation linkage visibility (which scans / reports / signals reference which entities).
- Source density analysis (which entities are most-cited vs. which are weakly-attested).

**Out of scope:**
- Auto-suggested relationships not derived from existing evidence.
- Auto-merge or auto-collapse anywhere in the UI (operator may navigate to A from here, but B itself does not mutate).
- Cross-tenant graphs (forbidden by 2.3).

**Dependencies:** none beyond foundation (entityGraph + G5 ontology + parity probe). Can start before G3 prod apply if needed.

### C. Aegis operational reasoning

**Goal:** Aegis (as the tenant intelligence officer) starts surfacing operational meta-conditions rather than only direct-lookup answers.

**In scope:**
- Unresolved graph conflicts surfacing — "X clusters in your tenant are waiting on canonical review."
- Weak-provenance investigation surfacing — "Investigation N is the basis for high-severity claims but has only one un-corroborated source."
- Unreviewed-recommendation surfacing — "Recommendation R has not had operator review for D days."
- Trajectory analysis — "Entity E has D new high-severity signals in the last W; previously dormant."
- High-signal / low-validation entities — "Entity E has many signals but no scan and no investigation."
- Relationship expansion analysis — "Entity E's degree has grown N% in W weeks; cluster expansion."
- Monitoring recommendation prioritization — "Entities with high trajectory but no `active_monitoring_enabled` are P0 candidates."

**Out of scope:**
- Acting on any of the above (all must be **recommendation-only** outputs).
- Reading cross-tenant data to compare (2.3).
- Free-association answers — every Aegis claim in this workstream must cite specific entities/clusters/signals; aggregate vagueness without enumeration is rejected.

**Dependencies:** B's confidence/provenance surfaces and D's confidence math materially improve C, but C can start with simpler signals first.

### D. Confidence / provenance layers

**Goal:** the math + display primitives that B and C lean on. Cross-cutting.

**In scope:**
- Analyst confidence — how much operator-validated state backs a claim.
- Corroboration score — number of independent sources behind a claim, normalized to source-type.
- Provenance quality — source-type weighting (audited monitor > AI inference > unscoped lookup).
- Freshness weighting — confidence decays as supporting evidence ages out of relevance windows.
- Trajectory confidence — how stable / how new the rising trajectory is.
- Operator validation state — has an operator reviewed / accepted / rejected / not-yet-seen.

**Out of scope:**
- Producing a single opaque "score" without revealing inputs (operator must always be able to drill into why).
- Storing confidence as a primary key or relying on it for access control (provenance + RLS are the access primitives; confidence is for **display + prioritization** only).

**Dependencies:** none beyond foundation. D is intentionally additive — existing display surfaces can adopt it incrementally.

## 4. Sequencing

The four workstreams are **not** ordered by user importance — they were listed in priority order as a single direction, but they have different dependencies:

| Workstream | Hard dep | Soft dep | Earliest start |
|---|---|---|---|
| A | G3 prod apply | — | Blocked until prod apply ratified |
| B | none | D for confidence display | Now |
| C | none | B for visualization, D for math | Now (simpler signals first) |
| D | none | — | Now |

**Proposed sequence (for ratification, not yet adopted):**

1. **D first (slim slice)** — define the confidence/provenance display primitives + a minimal trajectory/freshness implementation. Small enough to ship in one PR. Unblocks both B and C's display polish.
2. **B (visualization MVP)** — using the G5-reconciled graph axes + D's primitives. Operator can navigate the tenant graph and see why each edge/node exists.
3. **A (when G3 prod-applied)** — review queue + elect/reject UX. Builds on B's lineage visualization rather than reinventing.
4. **C (incremental)** — start with the easiest-to-surface meta-conditions (unresolved canonical clusters; entities with signals but no scan). Expand once B + D mature.

This sequencing avoids the bootstrap trap (building C without confidence math, then reworking) and aligns A with G3's prod arrival.

The alternative — **A first, in parallel with G3 prod-apply prep** — is reasonable if the operator's primary discomfort is unresolved canonical state piling up. I'll defer to operator preference.

## 5. Build discipline (per workstream)

Each workstream gets:

1. **Design ADR** raised as a markdown PR. Lists data shapes, retrieval paths, UI structure, recommendation/approval/execution boundary for that workstream's specific actions.
2. **Operator ratification** of the design ADR before code.
3. **Implementation PR** (or PR series), each with the parity probe + flight recorder regression check in CI.
4. **No prod apply** without explicit operator GO. Staging first.

## 6. Exit criteria for this phase

This phase exits when:

- Operator can review and act on every canonical cluster G3 surfaces (A complete).
- Operator can visually inspect the tenant graph with provenance and confidence visible on every node and edge (B complete).
- Aegis surfaces at least the 4 highest-signal operational meta-conditions in C without further prompting (C complete to MVP).
- Every operator-visible claim carries a confidence + provenance display backed by D's primitives (D complete to MVP).
- At no point in this phase does any code path execute a mutating side-effect without explicit operator approval (constraint 2.1 preserved throughout).

When all five hold, the platform is ready to revisit execution-loop work as a *separate* phase under a fresh ADR.

---

## Ratification block (operator)

- [ ] Phase declaration approved (Section 1).
- [ ] Hard constraints adopted as binding (Section 2).
- [ ] Workstream scopes A/B/C/D approved as defined (Section 3).
- [ ] Sequencing approved — choose: `D → B → A → C` (proposed) | `A → others` (operator-led) | `other`.
- [ ] Build discipline (Section 5) adopted.
- [ ] Exit criteria (Section 6) adopted.

Once ratified, the next concrete artifact will be the design ADR for whichever workstream is chosen as first.
