# ADR — Authoritative Operational Ontology (G5)

**Status:** PROPOSED 2026-05-28 — locks the per-axis "what is the operational reality" definitions across UI / entityGraph / DB. **G5 reconciliation work executes against this contract.** Strategic principle (operator, post-G4): *we are no longer primarily solving duplicate entities; we are solving authoritative operational reality definition.* No schema-permanent canonical collapse (G3) until this ontology is reconciled and re-validated by the parity oracle.

## Why this exists
G4 ran the parity probes (Kelly / Trent / BCH) and surfaced two distinct problem classes that look superficially similar:
- **Definition-divergence** (`data_model`): UI queries `poi_investigations`/`poi_reports`; `entityGraph` queries `investigations`/`generated_reports`. **They are different concepts** — collapsing them into "investigations" or "reports" without semantics is the actual operational-reality bug.
- **Coverage gaps**: my G4 probe wrongly marked `sources`/`relationships` as `ui_missing`, but `EntityDetailDialog` *does* query `entity_content` (`:222`) and `entity_relationships` (`:203`). The probe's UI-reality definition was incomplete. The data has been there.

So the work is **ontology**, not deletion: name the concepts properly, surface each in the right place, and align the parity probe to the actual UI queries.

## The per-axis ontology (the contract)

Each row defines what an "axis on an entity" *is*, on every surface. UI/Graph reconciliation in this slice = make every "aligned" row aligned and document every "dual" row as intentional.

| Axis | Authoritative table | UI surface (today) | Aegis Graph (after G5) | Parity expectation |
|---|---|---|---|---|
| **signals (directly correlated)** | `entity_mentions` ∪ `signals.auto_correlated_entities` | `EntityDetailDialog` signals tab (entity_mentions only) | `entityGraph.signals.directly_correlated` | **aligned** (modulo auto-correlated which UI misses — Graph-superset, documented) |
| **signals (client context)** | `signals` by `client_id`, excluding correlated | not surfaced on entity card | `entityGraph.signals.client_context` | **graph-authoritative** (separate concept per (c)-semantics) |
| **entity scans** | `poi_investigations` (per-entity automated investigation runs) | `EntityDetailDialog` investigations tab | **NEW** `entityGraph.entity_scans` | **aligned** (after G5b adds the axis) |
| **case-file investigations** | `investigations` (multi-entity narrative case files, `correlated_entity_ids` array) | `EntityUnifiedProfile` (separate component, line 50) | `entityGraph.case_investigations` (existing axis renamed for clarity) | **dual-surface** (distinct UI components for distinct concepts) |
| **entity threat reports** | `poi_reports` (per-entity AI-generated threat reports, linked to a `poi_investigation_id`) | `EntityDetailDialog` reports tab | **NEW** `entityGraph.entity_reports` | **aligned** |
| **operational reports** | `generated_reports` (tenant-scoped, period-based, multi-entity; e.g. fortress/wildfire) | separate Reports page | `entityGraph.operational_reports` (existing axis renamed) | **dual-surface** |
| **sources** | `entity_content` | `EntityDetailDialog` content tab | `entityGraph.sources` | **aligned** (after the probe's UI-reality fix) |
| **photos** | `entity_photos` | `EntityDetailDialog` photos tab | **NEW** `entityGraph.photos` | **aligned** |
| **relationships** | `entity_relationships` (endpoints) | `EntityDetailDialog` relationships tab | `entityGraph.relationships` | **aligned** (probe UI-reality fix) |
| **recommendations** | `aegis_recommendations` (target_entity_id) | **no UI surface yet** — operator-only via Aegis chat | `entityGraph.recommendations` | **graph-authoritative (intentional, until a UI tab exists)** |
| **monitoring_state** | `entities.active_monitoring_enabled` + `attributes.monitoring_context` | entity card header | `entityGraph.monitoring_state` | **aligned** |

**Scans clarification:** `autonomous_scan_results` (no entity link) is *not* the entity-scan concept. `poi_investigations` already *is* "the automated scan run on a particular person/entity." Treating `poi_investigations` as the entity-scan axis closes the v1 "scans not directly linkable" inconclusive in G4 — no new link table required.

## G5 reconciliation work (this PR — code)
1. **`entityGraph` adds three new axes:** `entity_scans` (`poi_investigations.entity_id`, tenant-scoped), `entity_reports` (`poi_reports.entity_id`), `photos` (`entity_photos.entity_id`). Each tenant-scoped, each emits a flight-recorder retrieval trace.
2. **`entityGraph` keeps existing axes** for the dual concepts: `case_investigations` (the `investigations` table; rename for clarity) and `operational_reports` (the `generated_reports` table). Renames are *additive aliases* — existing field names preserved for backward compat.
3. **`entityParityProbe` fixes UI-reality:** the UI map now queries `entity_content` (sources tab) and `entity_relationships` (relationships tab) — same queries the `EntityDetailDialog` runs. New axes added (`entity_scans`, `entity_reports`, `photos`). Old "definition_diverged" for investigations/reports replaced with per-concept aligned axes.
4. **Recommendations stays Graph-authoritative** with the rationale documented (no UI tab yet; operator-only via Aegis chat). A future slice may add a UI surface.

## Re-run + acceptance contract update
After G5b ships, the 3 committed probes (Kelly / Trent / BCH-boundary) re-run. **Acceptance:** every axis except `recommendations` (intentionally graph-authoritative until UI exists) and `signals.client_context` (graph-authoritative by (c)-semantics) returns `aligned`. **Only after this convergence may G3 (schema/backfill/canonical FK) proceed** — freezing a canonical FK over a still-divergent ontology bakes the divergence into permanent schema.

## Constraints carried
No auto-collapse · no canonical FK backfill · no irreversible schema mutation · no fuzzy edge promotion · provenance-backed traversal only · tenant-safe traversal only.

## Out of scope (logged, not blocking)
- Frontend UI surface for `recommendations` on the entity card (separate slice; today it's operator-only via Aegis chat — explicit + documented).
- G3 schema additions (canonical FK + edge provenance) — gated on parity convergence per this ADR.
- Operator-election surface for canonicalization clusters — G3+.
