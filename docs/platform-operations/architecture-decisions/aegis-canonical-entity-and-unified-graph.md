# ADR — Canonical Entity Model + Unified Retrieval & Intelligence Graph

**Status:** PROPOSED 2026-05-28 — design for ratification. Resumes the architectural workstream the operator gated behind observability (now operational: PRs #25/#26/#27/#28). **Build is gated on operator ratification of this contract** — the canonical-entity model + edge invariants are schema-permanent; the parity contract is the acceptance oracle. Strategic objective (operator): *move Aegis from "observable multi-agent AI" to "one coherent intelligence operating graph with deterministic operational reality."*

## Problem (formalized)
INC-CTX-CONTAM (BCH) showed the *retrieval substrate*. The Kelly Pietras incident showed the *graph substrate* is still fragmented: duplicate entity rows, investigation/OSINT retrieval disconnected from the entity card, separate tools improvising their own paths. Reality on prod: **2,894 tenant entities, 52 duplicate clusters (116 rows)** — small enough to canonicalize, big enough that fuzzy improvisation produces inconsistent operational truth.

Symptoms operator observed: Aegis returned conflicting Kelly profiles; denied an investigation that the entity card displayed; OSINT retrieval failed for the same entity it had just discussed. *Cause: entity, investigation, OSINT, signal, source, report retrieval are disconnected paths over a graph where the entity isn't even unique.*

## Principle (RATIFIED intent)
**One canonical entity per real-world thing; one traversal seam; provenance-backed edges; an executable parity oracle.** Everything related to an entity — signals, investigations, OSINT scans, sources, reports, relationships, recommendations, monitoring state — must resolve through the canonical entity via the same traversal. UI reality = Aegis retrieval reality = database reality, and that equality is **tested**, not asserted.

## 1. Canonical entity model
### 1a. Conservative canonicalization (RATIFIED clarification, 2026-05-28)
**"Same normalized name ≠ same entity."** Same `(tenant_id, lower(trim(name)))` produces a **candidate cluster**, never automatic proof of same real-world identity. Default canonical selection (earliest-created within the cluster) may only run **after** the cluster is classified `safe_to_collapse`. Required preconditions before any merge / canonical redirect:
1. **Same tenant** (tenant-scoped resolution; cross-tenant collapse is *never* permitted).
2. **Compatible entity type** (e.g., `person` ≠ `organization`; a type mismatch blocks collapse).
3. **No protected-principal / investigation-placeholder semantics conflict** (entities flagged as protected principals, or created as investigation placeholders, never auto-collapse with other rows).
4. **No conflicting source-of-truth evidence** (distinct verified external IDs / authoritative sources that disagree block collapse).
5. **Operator override available** (an operator may explicitly elect a canonical, or explicitly *reject* a collapse for a cluster; overrides are durable + audited).
6. **Provenance recorded** (every classification + override emits a structured trace — Flight Recorder + persistent record on canonicalization writes).

Clusters that fail any precondition resolve to classification `unresolved_conflict` or `pending_operator_review` (never silent `safe_to_collapse`). **G2 identifies + resolves safely; G2 never mutates** — auto-collapse of the 52 detected duplicate clusters does **not** run in G2 and is explicitly prohibited.

### 1b. Storage (G3 — schema gated separately)
- Add `entities.canonical_entity_id uuid` (FK → `entities.id`, nullable). Canonical row itself = `NULL`. Duplicate → points to its canonical.
- Add `entities.canonical_at timestamptz` + `entities.canonical_chosen_by uuid` (operator who elected) + `entities.canonical_classification text` (`safe_to_collapse` | `operator_elected` | `pending_review` — audit trail) + `entities.canonical_provenance jsonb` (rules applied, blockers, source).
- Durable operator-override surface (elect or *reject* a cluster collapse). **No backfill until G3 ratification.**

### 1c. Resolution seam (G2 — code-only, the focus of this slice)
`resolveCanonicalEntity(sb, tenantId, ref)` in `tenant-entity-graph.ts`. `ref` may be id, name, or alias. **Tenant-scoped + fail-closed** (no tenant → `null`). Returns:
```
{ canonical: Entity | null,                     // chosen canonical IFF safe_to_collapse | singleton | operator_elected; else null
  cluster:   Entity[],                          // all candidates considered
  classification: 'singleton' | 'safe_to_collapse' | 'unresolved_conflict' | 'pending_operator_review',
  blockers:  string[],                          // 'type_mismatch' | 'protected_principal' | 'placeholder_conflict' | 'source_of_truth_conflict' | ...
  provenance: { input_ref, matched_by, rules_applied, operator_override_id? } }
```
**Doctrine:** every entity-keyed retrieval first calls `resolveCanonicalEntity`. If `canonical` is non-null the caller proceeds; if null, Aegis returns *"multiple candidates — operator must elect"* with the cluster — it **never silently picks one**. Non-canonical-id lookups (G3-and-later, once the FK exists) transparently redirect to canonical only when classification is `safe_to_collapse` or `operator_elected`.

## 2. Unified retrieval graph (the traversal seam)
One exported function:
```
entityGraph(sb, tenantId, ref): {
  canonical: Entity,                      // resolved via resolveCanonicalEntity
  signals:           { directly_correlated[], client_context[] },  // (c)-semantics, no fuzzy promotion
  investigations:    Investigation[],     // via investigation_persons / investigation_entries
  sources:           Source[],            // entity_content.source ∪ monitoring sources
  scans:             Scan[],              // autonomous_scan_results + investigate-poi runs
  reports:           Report[],            // generated_reports for the entity
  relationships:     Edge[],              // entity_relationships, both endpoints, both canonicalized
  recommendations:   Recommendation[],    // aegis_recommendations targeting the entity
  monitoring_state:  { active, context, last_checked },
  provenance:        Provenance,          // one trace per traversal step
}
```
- **Every step is tenant-scoped at the SQL level + emits a flight-recorder retrieval trace** (surface, scope, returned IDs, fallback, timing, provenance) via the existing `rec?: Recorder` threading.
- **No heuristic name/title joining** between signals and the entity — (c) semantics carried from the OMCR work: `directly_correlated` = `entity_mentions ∪ auto_correlated_entities`; `client_context` = same-client signals reported *separately*, never conflated.
- Replaces / subsumes the existing `entityIntelligence`/`entityDetails`/`entitySignals`/`entityRelationships` certified surfaces (they become thin wrappers or callers of `entityGraph`).

## 3. Entity-edge hardening (`entity_relationships`)
Every operational edge carries:
- `source_entity_id`, `target_entity_id` (both **canonical** ids — non-canonical refs rejected at write time).
- `tenant_id` (denormalized for scoping, mandatory).
- `relationship_type` (enum; see existing types).
- `provenance jsonb` (`{ created_by, derivation, source_doc_id, source_signal_id, model?, prompt?, confidence }`).
- `confidence_score numeric`.
- DB CHECK: `tenant_id IS NOT NULL`, both endpoints canonical (verified via trigger). **No fuzzy/heuristic edge may be promoted to `entity_relationships` automatically** — fuzzy linkages remain at the signal layer; promotion is an explicit operator/approval action.

## 4. Parity oracle (the acceptance contract)
Executable function `entityParityProbe(sb, tenantId, ref)` returns:
```
{ canonical_id, mismatches: [{ axis, ui_count, graph_count, db_count, missing_ids[] }], passed: boolean }
```
For each axis ∈ {`signals`, `investigations`, `sources`, `scans`, `reports`, `relationships`, `recommendations`, `monitoring_state`}:
1. **Graph reality:** what `entityGraph(ref)` returns.
2. **DB reality:** raw SQL on the underlying tables (the source of truth).
3. **UI reality:** the same queries the entity-detail UI runs (extracted into a shared helper so they cannot drift).
4. Assert equality on counts + ID sets; record mismatches.
**Acceptance contract:** mismatches = 0 for canonicalized entities. A non-zero result fails CI when run as a test + lands a flight-recorder note for the run.

Initial parity probes (committed test data): Kelly Pietras (the observed failure), BC Children's Hospital (cross-tenant context), Trent Reznor (the certified-slice reference). Three deterministic probes that must pass before declaring graph health green.

## 5. Flight Recorder integration
- `entityGraph` accepts an optional `rec?: Recorder` (same pattern as the memory/cross-agent retrieval primitives) and emits one `rec.retrieval({ surface: 'entityGraph:<axis>', tenant_scope, returned_object_ids, provenance })` per traversal step.
- `entityParityProbe` emits a structured `rec.retrieval({ surface: 'parity_probe', provenance: { mismatches } })` per run; failures are persistent forensic evidence via `aegis_retrieval_trace`.
- `resolveCanonicalEntity` emits a trace recording the resolution path (input ref → canonical id → audit), so non-canonical access is observable, not silent.

## 6. Constraints (carried)
Certified-safe retrieval only · fail-closed grounding (no tenant → empty graph) · tenant-scoped at every SQL edge · provenance-backed (no claim without a trace) · operator-auditable replayability (Flight Recorder).

## Build slices (gated; do not skip)
1. **Slice G1 (this ADR + schema):** ADR + migration adding `canonical_entity_id`/`canonical_at`/`canonical_chosen_by` + edge-provenance columns; **no backfill yet**, no canonical-write trigger yet — schema is additive and safe to live without callers. *Apply on ratification.*
2. **Slice G2 (resolution + traversal — code-only, NO mutation):** `resolveCanonicalEntity` + `entityGraph` in `_shared/tenant-entity-graph.ts`; flight-recorder retrieval traces threaded; existing `entityIntelligence` etc. become thin wrappers calling `entityGraph`. **G2 identifies clusters and resolves safely (returning `safe_to_collapse` / `pending_operator_review` / `unresolved_conflict`); it never writes `canonical_entity_id`, never auto-collapses the 52 detected clusters, and performs no data mutation.** Staging validation only.
3. **Slice G3 (canonicalization, separately gated — explicit GO required):** schema additions (canonical FK + classification + provenance + override columns); backfill **only after** running the safety-classifier across the 52 clusters and confirming the safe-to-collapse subset with the operator; add the write-trigger that **rejects non-canonical edge endpoints**; operator-election + operator-reject surfaces (admin UI/RPC). The conservative classifier — not "earliest-created" alone — drives backfill.
4. **Slice G4 (parity oracle):** `entityParityProbe` + the three committed probes (Kelly / BCH / Trent) as CI tests + a forensic replay note.
5. **Slice G5 (Aegis routing + cleanup):** `search_entities`/`get_entity_intelligence` route through `entityGraph`; redirect non-canonical resolutions transparently; retire/deprecate any disconnected entity-retrieval path the audit surfaces; coverage-matrix update.

## Out of scope (logged, not blocking)
- `tenantRetrieve()` R1 retrieval seam (still unbuilt; orthogonal — when it ships, certified `entityGraph` is the first surface to register in `CERTIFIED_TENANT_SURFACES`).
- agent-chat per-branch tool capture (Slice 3 follow-up).
- Slice 4 grounding-marker persona capture (still acceptable interim `unknown_unavailable`).

## What ratification authorizes
1. **G2 (code-only) begins now** — `resolveCanonicalEntity` + `entityGraph` traversal seam in `_shared/tenant-entity-graph.ts`. No schema change. No `canonical_entity_id` writes. No auto-collapse. Staging validation only.
2. **Slices G3–G5 remain separately gated** — each requires explicit operator GO before prod application (G3 schema/backfill especially, since canonicalization writes are the schema-permanent part).
3. **Parity contract is the acceptance gate** — a slice doesn't ship if it widens parity mismatches; the workstream isn't "done" until the three committed probes (Kelly / BCH / Trent) pass deterministically.

**No code in this ADR. Formalization of the canonical-entity + unified-graph contract; build follows ratification.**
