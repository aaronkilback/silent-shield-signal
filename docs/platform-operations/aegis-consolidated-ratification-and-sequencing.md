# Aegis — Consolidated Ratification + Implementation Sequencing Plan (2026-05-27)

**Purpose:** fold the five interlocking design docs + the live containment + the ratified provenance doctrine into **one operating doctrine** and **one execution roadmap.** No implementation. No mutations. Planning only.

Source docs: `architecture-decisions/aegis-three-layer-memory.md`, `audits/aegis-l2-content-provenance-audit-2026-05-27.md`, `incidents/INC-AEGIS-ACTION-INTEGRITY-2026-05-26.md`, `architecture-decisions/aegis-authority-modes.md`, `architecture-decisions/aegis-ops-control-plane.md`, `incidents/INC-LEARN-CONTAM` (in the L2 audit), and CLAUDE.md Provenance Doctrine.

---

## 1. Final doctrine (the locked principles)
1. **Aegis = tenant intelligence officer** — customer-facing, own-tenant-bounded, broad and operational (not passive Q&A).
2. **Aegis Ops = operator control plane** — internal, cross-tenant **by explicit target**, full management authority.
3. **actor ≠ owner** — every write records ownership = target_tenant/target_client (Provenance Doctrine) AND actor = the operator/tenant-user (audit). Never conflated.
4. **Tenant facts are L1** — strictly tenant-scoped; disclosed only to that tenant.
5. **Approved anonymized/public learning is L2** — shareable only when proven (content classification, not schema).
6. **Operator/forensic memory is L3** — privileged; never silently mixed into a tenant answer.
7. **No impersonation** — the operator never becomes a user; no claims-override path exists.
8. **No implied capabilities** — only registry-listed, implemented tools are callable.
9. **No fake success** — unknown/unpermitted/failed = honest refusal, never simulated.
10. **Post-action receipts required** — mutations return measured post-conditions, never "Done."
11. **Retrieval order** — tenant-scoped retrieval FIRST, approved global enrichment SECOND.
12. **Service-role is untrusted by default** — enforcement is DB-level (CHECK/trigger) + the shared write seam, not RLS or prompt discipline.
13. **Cross-Tenant Retrieval Exclusivity (RATIFIED AMENDMENT, 2026-05-27)** — *"All cross-tenant retrieval must occur exclusively through the audited Aegis Ops retrieval seam. No tenant-facing Aegis code path may directly query: cross-tenant data, shared global stores, service-role global stores, or unscoped helper queries."* Closes the historical failure class (INC-AEGIS-TRUST unscoped reads, INC-CRT leaks, INC-LEARN-CONTAM shared-store reads). Enforcement: tenant-facing code may only reach L1 via `tenantRetrieve()` (own-tenant) and approved-clean L2 via `globalLearning()`; any cross-tenant access is an Aegis Ops operation through the audited `operatorAction`/Ops retrieval seam. A CI guard fails the build on any tenant-surface `.from()` of a cross-tenant/global/service-role store outside the seam.
14. **Certified-Safe Retrieval Allowlist (RATIFIED, 2026-05-27)** — *"Tenant Aegis may retrieve ONLY from certified-safe surfaces through `tenantRetrieve()`. Any uncertified surface is unavailable by default."* Retrieval is an **allowlist, not a denylist**: a surface is unreachable until explicitly certified and added to `CERTIFIED_TENANT_SURFACES`. Certification requires — declared scope key (seam-only, no raw path); empirical cross-tenant-isolation proof (0 cross-tenant rows); no leaky sibling path; and (L2) certified anonymized content. `tenantRetrieve()` refuses uncertified assets; Aegis honest-refuses. Status 2026-05-27: allowlist **empty** (R1 not built). Spec: `architecture-decisions/aegis-tenant-intelligence-retrieval.md`.

---

## 2. Ratification status
| Artifact | Status | Note |
|---|---|---|
| INC-XTEN Provenance Doctrine | **RATIFIED** (CLAUDE.md, 2026-05-26) | remediation IN PROGRESS (phased) |
| L2 content-provenance audit | **COMPLETE — evidence accepted** | findings are ratification input; not a doctrine to ratify |
| INC-LEARN-CONTAM containment | **LIVE** (prod + main `eb9956e8`) | incident OPEN; remediation pending |
| 3-layer memory model (L1/L2/L3) | **RATIFIED (2026-05-27)** | + Cross-Tenant Retrieval Exclusivity amendment (principle 13) |
| Aegis action integrity (AR1–AR6) | **RATIFIED (2026-05-27)** | remediation design ready |
| Authority modes (split identity, no impersonation) | **RATIFIED (2026-05-27)** | |
| Aegis Ops control plane | **RATIFIED (2026-05-27)** | |

**Blocked items:** the ‡ shared-learning read tools (`get_global_learning_insights`, `query_expert_knowledge`, `get_cross_tenant_patterns`) are **BLOCKED** behind INC-LEARN-CONTAM remediation. MODE-B global-learning analysis runs on the approved-clean L2 subset only until then.

---

## 3 + 4. Implementation order with stop gates
Standing invariant: **(A) live containment persists through every phase until (M) lifts it.** Order respects dependencies; each phase has proof / rollback / validation / surfaces / prod-mutation.

| # | Phase | Depends on | Proof required | Rollback | Validation | Affected surfaces | Prod mutation? |
|---|---|---|---|---|---|---|---|
| **A** | Preserve live containment | — | triggers active (`tgenabled='O'`) + 3 tools gated; counts ≤ baselines | n/a (safe state) | re-query triggers + row counts | dashboard-ai-assistant; 3 DB tables | **none** (already applied) |
| **B** | R1 retrieval seam (`tenantRetrieve`/`globalLearning`) | A | all L1 reads route the seam; CI grep guard fails on direct `.from()` | revert deploy | seam unit tests + grep audit | edge fns + `_shared` | code deploy only |
| **C** | R2 class-D leak fixes | B | cross-tenant read returns only target-tenant rows (CRT 7→1 corrected) | revert deploy | per-tool tenant-scope tests; impersonation-style probe | ai-tools-query, handlers, buildCOP, agent-chat | code deploy only |
| **D** | L2 provenance classification + gates (k-anon, per-row identity gate, curated views) | audit, B | NER scan on L2 views = **0** identity hits | keep containment (L2 stays off) | re-run full NER scan; k-anon floor test | DB views + `globalLearning` | DB additive (views) + code |
| **E** | AR1 registry-derived capabilities | — | registry ∩ dispatcher reconciled; manifest generated; CI fails on drift | revert | registry/dispatcher diff = ∅ | `_shared` registry + CI | code deploy only |
| **F** | AR3 post-condition receipts | E | every mutating tool returns measured post-state + counts | revert | per-tool receipt tests | edge fns | code deploy only |
| **G** | AR4 honest refusal | E | unknown/unpermitted tool → refusal, never simulated; outranks assertion | revert | refusal matrix tests | persona + executeTool gate | code deploy only |
| **H** | Aegis / Aegis Ops split identity | B,C,E,F,G | tenant surface has 0 platform tools wired; 0 claims-override paths | revert | partition audit (registries disjoint) | both surfaces + entry points | code deploy only |
| **I** | `operatorAction` seam + `operator_actions_log` | H | every Ops mutation writes a log row; missing target → refusal | drop table + revert | seam tests; audit-row assertions | new DB table + Ops core | DB additive (new table) + code |
| **J** | Aegis Ops capabilities (read→mutate→destructive) | E,F,G,H,I | each tool audited+receipted; destructive behind confirm token | unwire tool / revert | per-capability staging matrix | Aegis Ops surface | code; **data only when operator acts** (gated) |
| **K** | Aegis tenant capabilities (broad, bounded; incl. AR5 bulk-monitor, create_source, entity CRUD) | B–H | per-capability tenant-scoped + receipt + no cross-tenant | unwire / revert | per-capability tenant tests | Aegis surface | code; data only on tenant action |
| **L** | INC-XTEN continuation (2B incidents, 2C entities, Phase 3 archival/storage, Gate F freeze, sweep #19) | own gates | per-table CHECK proofs (compliant/​bare-null/​cross-tenant/​service-role) | DROP constraints (instant) | staging→prod gated matrix | DB + writer fns | **DB migrations (gated)** |
| **M** | Shared-learning remediation (anonymization gate → re-derive clean L2 → quarantine → lift triggers/re-enable) | D,I | NER scan = 0 on re-derived L2 **before** lifting triggers | re-apply triggers (re-contain) | scan + staged re-enable | learning pipeline + Ops | **DB + code (cleans contaminated data)** |

**Gate discipline (all phases):** staging-first where a backend/DB change exists; explicit operator GO before any prod data mutation; no credential mutation without separate "execute now"; verify in preview before promoting; commit deployed code to `main` (durability).

---

## 5. Open incidents / tasks map
| Incident / project | Status | Tasks | Rolls into |
|---|---|---|---|
| **INC-XTEN** (provenance) | doctrine RATIFIED; Gate 1 + Phase 2A done; 2B paused; 2C/3/Gate-F open | #15-17✅/#17,#19 | Phase **L** |
| **INC-LEARN-CONTAM** | **contained LIVE**; remediation open | #27 | Phases **A** (hold) + **M** (fix) |
| **INC-AEGIS-TRUST** (perception leaks) | audit complete; fixes pending | #24 | Phases **B/C** (R1/R2) |
| **INC-AEGIS-ACTION-INTEGRITY** | audit complete; remediation pending | #26 | Phases **E/F/G** + **K** (AR5) |
| **INC-CRT-VISIBILITY** | **CLOSED** — notification + sources fixes deployed | #22✅ #23✅ | — (verify under H) |
| **INC-CRT-DOCUMENT-SCOPE** | **not a distinct incident doc** — surfaces as INC-AEGIS-TRUST Vince #3 (`archival_documents` has no `tenant_id`, client_id-scoped, null-client docs invisible) | (folded) | Phase **L** (Phase 3 archival `tenant_id`) — *recommend formalize if you want it tracked separately* |
| **INC-DOC / INC-ART cluster** (artifact trust) | partially addressed; durable-delivery / no-raw-signed-URL pattern is the fix | (project memory) | Phase **J** (doc/report Ops: repair storage ownership + links) + **L** (storage provenance) |
| **DGIC** (admission controller) | **PAUSED**, preserved on `feat/dgic-phaseB-pregates` | project | resume only after PR #13 durability + this roadmap's early phases; **not** in this plan's critical path |

---

## 6. What NOT to do (explicitly forbidden)
1. **Do NOT build missing tools (AR5 / Aegis Ops capabilities) before retrieval + capability truth is fixed.** K and J come AFTER B,C,D,E,F,G,H. A powerful tool on an unscoped read or an ungrounded capability claim multiplies blast radius. (Truthful-limited-operator > powerful-dishonest-one.)
2. **Do NOT re-enable the contaminated learning stores** (`expert_knowledge`, `global_learning_insights`, `agent_beliefs`) or lift the write-freeze triggers before the Phase-M anonymization gate + re-derivation + a clean NER scan. Containment (A) holds until M proves clean.
3. **Do NOT use or reintroduce impersonation.** No "act as Vince," no claims/JWT/tenant-context override. Operator = operator + explicit `target_tenant`, always.
4. **Do NOT treat service-role as trusted.** Enforcement lives at the DB layer (CHECK/trigger) + the shared write seam — never RLS-only and never application-trust.
5. **Do NOT rely on prompt discipline instead of enforcement.** Capability truth, refusal, partition, and scoping are structural (registry, gate, seam, partition) — the persona reflects them, it does not implement them.
6. (Corollaries) Do NOT ship a "two personas over one wired-up tool set" (loses the partition); do NOT let any Ops mutation run without `target_tenant` + audit row + receipt; do NOT mark INC-LEARN-CONTAM or INC-XTEN closed until their remediation phases (M / L) pass their proofs.

---

**RATIFIED 2026-05-27** (operator sign-off): the 3-layer memory model, action-integrity doctrine, authority modes, and Aegis Ops control plane are platform doctrine, plus the Cross-Tenant Retrieval Exclusivity amendment (principle 13). INC-XTEN Provenance Doctrine remains ratified. First executable phase = **B (R1 retrieval seam)** — not to begin without explicit go. No code, no mutations performed in producing this plan.
