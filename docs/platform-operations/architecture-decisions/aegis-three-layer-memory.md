# ADR — Aegis Three-Layer Memory: Global Learning ≠ Global Data Visibility

**Status:** DESIGN (architecture correction, not a patch). No code changes. Supersedes the ad-hoc "query the data" model behind INC-AEGIS-TRUST.
**Principle:** Fortress learns across the fleet (Tesla model); Aegis discloses only tenant-authorized facts. **Retrieval is tenant-scoped FIRST; global enrichment SECOND.**

## The three layers
| Layer | Contains | Tenant binding | Disclosure rule |
|---|---|---|---|
| **L1 — TENANT MEMORY** | entities, incidents, sources, docs, investigations, reports, signals, notes | Strict `tenant_id`/owned-client | Only the caller's tenant. Ever. |
| **L2 — GLOBAL LEARNING** | patterns, heuristics, reliability scores, doctrine, anonymized insights, reusable playbooks, threat archetypes, model beliefs **with no tenant facts** | None (tenant-agnostic by construction) | Shareable to all — **only if anonymized** (no tenant-identifying facts). |
| **L3 — PRIVILEGED OPERATOR** | cross-tenant support/debug/forensics/platform-ops views | super_admin only | Explicit operator mode; **never silently mixed** into a tenant answer. |

**Composition discipline:** *"For CRT, I see X [L1]. Based on fleet patterns, this resembles Y [L2]."* — never *"Here is what exists across the platform."*

## Content-provenance classification (PRIMARY classifier — supersedes the tenant_id column)
**A table does NOT qualify as L2 merely because `tenant_id` is absent.** Layer membership is decided by *content provenance*, not by schema columns. Every store is classified into one of four content classes, and the class — not the presence/absence of a tenant column — determines the layer:

| Content class | Definition | Layer | Disclosure |
|---|---|---|---|
| **raw tenant-derived** | contains, or can reconstruct, tenant-identifying facts (entity/exec names, signal text, doc contents, incident specifics, source configs) — *regardless of whether a `tenant_id` column exists* | **L1** | tenant-scoped only |
| **transformed anonymized** | derived from tenant data but **provably** stripped of identifying facts (aggregate counts, scores, archetypes, heuristics) — identity-removal must be verified | **L2** | shareable |
| **public** | sourced externally, no tenant content (doctrine, standards, curated expert/world knowledge) | **L2** | shareable |
| **operator-only** | platform-ops/forensic/debug telemetry | **L3** | super_admin only |

**Default-deny rule:** until a store's content is audited and proven *transformed-anonymized* or *public*, it is treated as **raw tenant-derived (L1)**. "No `tenant_id` column" is not evidence of anonymization.

## Store inventory (CANDIDATE classification — each L2 entry is provisional pending a content audit)
**L1 — confirmed raw tenant-derived (tenant-scope every read):** `entities`, `incidents`, `signals`, `sources`(created_by_tenant_id), `archival_documents`, `investigations`, `reports`, `generated_reports`, `poi_reports`, `tenant_knowledge`, `learning_profiles`(tenant_id), `learning_feedback`(tenant_id), `investigation_playbooks`(tenant_id), `false_positive_patterns`(client_id), `agent_beliefs`(client_id), `trajectory_positions`(client_id).
**L1 — SUSPECT (no tenant column but content likely tenant-identifying → default-deny to L1 until audited):** `incident_knowledge_graph` (built from incidents — carries entity/incident specifics), `threat_trajectories`/`trajectory_phases` (per-target trajectories), `saved_knowledge_nuggets` (user-saved snippets), `global_chunks`/`global_docs` (**if** sourced from uploaded tenant docs — same risk class as INC-DOC-002), `expert_knowledge` (**if** any extraction came from tenant material).
**L2 — candidate transformed-anonymized (must PROVE identity-removal):** `cross_tenant_patterns`, `source_credibility_scores`, `sequence_patterns`, `signal_pattern_contributors`, `global_learning_insights`, `learnings`, `universal_learning_log`.
**L2 — candidate public (verify no tenant content embedded):** `doctrine_documents`/`doctrine_library`, `knowledge_base_*`, `world_knowledge_sources`, `playbooks`, `expert_profiles`.
**L3 — operator-only:** `watchdog_learnings`, `agent_learning_sessions`.
**⚠** This inventory is the *input* to the L2-provenance-classification work item (see execution order) — it is not a ratified mapping. No candidate is treated as L2 in code until its content audit passes.

## Reclassification of Aegis read paths — A) tenant / B) global-learning / C) privileged / D) DANGEROUS MIXED
| Read path | Current class | Correct class | Evidence |
|---|---|---|---|
| `ai-tools-query` (all reads) | **D — raw L1, unscoped** | A (tenant L1) | `ai-tools-query:14-65` ✅ — `tenant_id` discarded |
| `buildCOP` (every prompt) | **D — raw L1 globally** | A (tenant COP) + B (anonymized fleet aggregates) | `common-operating-picture.ts:50-102` ✅ |
| `get_active_incidents` (handler) | **D — raw L1 incidents, unscoped** | A | `handlers-signals-incidents.ts:199-216` ✅ |
| `search_entities` | **D — raw L1 entities, unscoped** | A | `ai-tools-query:44` / `handlers:257` ✅ |
| `query_fortress_data` (ai-tools-query) | **D — unscoped** | A | `ai-tools-query:581` |
| `query_fortress_data` signals/incidents/clients (dashboard) | A (correct) | A | `index.ts:6002/6016/6045` |
| `query_fortress_data` entities / document library | A-partial (by `client_id`, undercounts) | A (by tenant) | `index.ts:6024/1605/1686` |
| `lookup_ioc_indicator` | **D — discloses cross-tenant signal sightings** | B (anonymized indicator reputation) + A (tenant's own sightings) | `ai-tools-query:779-836` |
| report retrieval (`get_security_reports`) | A (correct) | A | `index.ts:1402/1448` |
| `expert_knowledge`/doctrine/playbooks/source_credibility (if read) | B (legitimate) | B | the L2 stores above |

**The disclosure leak is entirely class-D = raw L1 served cross-tenant.** None of it is genuine L2 learning — so eliminating it does **not** reduce cross-tenant learning.

## Architecture gap analysis
1. **No enforced layer boundary at retrieval.** Aegis tools query tables directly; "global" behavior comes from *unscoped L1 reads* (ai-tools-query, buildCOP, the handlers), not from the L2 stores. There is no seam that says "L1 → tenant-scope; L2 → global."
2. **`buildCOP` conflates layers** — injects raw all-tenant incidents/signals/entities into every prompt as "situational picture." Should be tenant-scoped L1 + (optionally) L2 *anonymized aggregates* (counts, archetypes — no titles/names).
3. **`ai-tools-query` is an unscoped L1 retrieval backend** mislabeled as a neutral "tools" service. It belongs in L1 (tenant-scoped) — it is not, and must not be, an L2 service.
4. **Tenant-derived learning is client-tagged, not anonymized** (`false_positive_patterns`, `agent_beliefs`, `trajectory_positions` carry client_id). The directive wants FP-patterns/heuristics/beliefs as L2 — that requires an **anonymization promotion step**, not just reading them globally.
5. **No L3 boundary.** super_admin's RLS-bypass + the unscoped tools mean operator/forensic cross-tenant visibility silently bleeds into ordinary tenant answers. There is no explicit "operator mode."
6. **Truth discipline absent** — Aegis presents L1-from-all-tenants as the current tenant's ground truth (no layer labeling).

## Remediation plan (design; each step separately gated)
**R0 — Cross-Tenant Retrieval Exclusivity (RATIFIED AMENDMENT, 2026-05-27).** *"All cross-tenant retrieval must occur exclusively through the audited Aegis Ops retrieval seam. No tenant-facing Aegis code path may directly query: cross-tenant data, shared global stores, service-role global stores, or unscoped helper queries."* Tenant-facing code reaches L1 only via `tenantRetrieve()` (own tenant) and approved-clean L2 only via `globalLearning()`; **any** cross-tenant read is an Aegis Ops operation routed through the audited Ops retrieval seam (`operatorAction`, explicit `target_tenant`). The CI guard below is therefore blocking, not advisory. Closes the historical failure class (INC-AEGIS-TRUST unscoped reads, INC-CRT leaks, INC-LEARN-CONTAM shared-store reads).

**R1 — Retrieval seam (structural, not per-tool discipline).** Two helpers, mirroring the write-side `createArtifact` seam:
- `tenantRetrieve(table, tenantCtx, …)` — the ONLY way to read L1; resolves the caller's tenant (dashboard derivation is already sound, `index.ts:10061`) and scopes by `tenant_id` (or owned-client) **before** querying. All L1 reads route through it.
- `globalLearning(kind, …)` — reads L2 stores only; tenant-agnostic by construction; returns patterns/scores/archetypes/playbooks, never raw L1 rows.
- Aegis composes: L1 first, L2 enrichment second. A CI grep guard forbids direct `.from('<L1 table>')` reads outside `tenantRetrieve` (audit-only → blocking), exactly like the provenance writer-freeze.

**R2 — Fix the class-D paths (P0, the INC-AEGIS-TRUST leaks).** Scope `ai-tools-query` (or stop routing tenant-bearing tools to it); fix `get_active_incidents`/`search_entities`/`search_signals_by_entity`/`get_signal_incident_status` handlers; scope agent-chat reads + add caller auth. These are L1; tenant-scope them.

**R3 — Re-layer `buildCOP`.** Split into `buildTenantCOP(tenantCtx)` (L1, scoped) + `buildFleetLearning()` (L2, anonymized aggregates — e.g., "12 protest-cluster incidents fleet-wide this week" with NO tenant/entity names). Inject both, clearly labeled.

**R4 — IOC reputation as L2.** `lookup_ioc_indicator` returns the *indicator's* known-bad reputation (L2, anonymized — the domain/hash is malicious regardless of tenant) **plus** the caller-tenant's own sightings (L1). It must NOT surface which other tenant/client saw it (`ai-tools-query:818` currently leaks `client_name`).

**R5 — Anonymization promotion for tenant-derived learning.** A pipeline that distills `false_positive_patterns`/`agent_beliefs`/incident-graph into anonymized L2 insights (strip client/entity/exec identities, doc/signal text). Only the anonymized product is L2-readable; the client-tagged originals stay L1. This is how FP-patterns/heuristics/beliefs become legitimately global.

**R6 — Explicit L3 operator mode.** Cross-tenant/forensic tools become a labeled privileged tool set, gated to super_admin and **rendered as operator output, never blended into a tenant answer**. super_admin acting *as* a tenant uses the tenant-scoped L1 path (the impersonation-scope fix already shipped for notifications is the model).

**R7 — Composition + truth discipline.** Aegis responses tag provenance ("For CRT … / fleet pattern …"); distinguish "0 results" from "hidden by scope"; never emit "across the platform" except L2-anonymized.

## Cross-stream execution order (CANONICAL — perception/truth before power)
This ADR (reads) and INC-AEGIS-ACTION-INTEGRITY (actions) share one ordering. **Rationale: a truthful, limited operator is safer than a powerful, dishonest one.** Capability-building (AR5) is LAST — building new operator tools on top of un-scoped reads or un-grounded capability claims would multiply the blast radius.

1. **R1 — retrieval seam** (`tenantRetrieve` / `globalLearning`)
2. **R2 — class-D leak fixes** (= INC-AEGIS-TRUST P0)
3. **L2 provenance classification** (content audit of every candidate above; default-deny to L1)
4. **AR1 — registry-derived capability truth** (kill the prose denylist)
5. **AR3 — mandatory post-condition receipts** (measured post-state, not "Done")
6. **AR4 — universal honest refusal** (outranks capability-assertion)
7. **AR5 — build the genuinely-missing capabilities** — ONLY after 1–6 land

(R3 buildCOP re-layer, R4 IOC, R5 anonymization-promotion, R6 L3 mode, R7 composition discipline, AR2 phantom removal, AR6 dangerous-action gate slot in as their prerequisites complete — none precede R1/R2.)

## Relationship to existing doctrine
- This is the **read/disclosure** counterpart to the **write** Provenance Doctrine (CLAUDE.md): writes bind ownership; reads scope disclosure. Same "tenant-first" spine.
- **Write integrity is improving but NOT yet trusted.** Post PROD-EE / INC-XTEN C3 the dashboard write paths are *better*, but they are not certified tenant-safe until the Provenance Doctrine (INC-XTEN) fully closes — they remain in-scope, not exonerated.
- R2 subsumes the INC-AEGIS-TRUST P0 isolation fixes; R1's CI guard mirrors the provenance writer-freeze (#19 sibling sweep).
- Preserves all *proven-L2* learning — the Tesla-fleet model is intact; only raw L1 cross-tenant *disclosure* is removed.

**No mutations. Design correction. Implementation is separate, gated, and sequenced after ratification.**
