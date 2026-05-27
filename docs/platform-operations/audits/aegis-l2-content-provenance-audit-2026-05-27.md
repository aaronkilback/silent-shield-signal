# Aegis L2 Content-Provenance Audit — Layer Classification Matrix (2026-05-27)

**Purpose:** Evidence-based (sampled-content) classification of every candidate shared-learning store, to ratify the L1/L2/L3 layer model on *proven content* rather than schema names. **Prerequisite to ratifying the 3-layer ADR.** Read-only; no mutations.

**Rule applied:** A store/row is **L2 only if its content is PROVEN transformed-anonymized OR purely public.** If tenant facts can be reconstructed (incl. via FK), or identity can leak, or uncertain → **classify downward to L1.** "No `tenant_id` column" is NOT evidence of anonymization.

## Headline findings
1. **Layer is a property of (store × row-class), not of the store.** The two largest "global" stores are **internally mixed** — they hold L1 *and* L2 rows in the same table. **L2 read access therefore cannot be granted at table granularity; it must be a curated VIEW** (row-class filter + FK-strip + k-anonymity).
2. **`agent_beliefs` (15,532) splits deterministically by `belief_type`:** **114** `entity_narrative` rows are 100% client-bound and name clients (*"Petronas Canada… faces environmental litigation"*) with contributing-signal FKs → **L1**. **All 15,418 other rows are 100% `client_id IS NULL`** and generic (*"Polymorphic malware…", "CNNs are indispensable…"*) → **L2-candidate**.
3. **`global_learning_insights` (1,459) splits by `insight_type`:** **1,272 `world_expertise`** (tenant_count=0, public figures like Chertoff) → **L2 public**; **187 `ai_meta_insight`+`signal_category_trend`** (platform-wide category counts) → **L2 transformed-anon, CONDITIONAL on a k-anonymity floor**.
4. **Reconstruction-by-FK is the silent leak vector.** `signal_pattern_contributors`, `universal_learning_log`, and `agent_beliefs[entity_narrative]` carry signal/feedback UUID FKs that resolve directly into L1 tenant data even when the visible text looks generic → **L1**.
5. **Content evidence corrected two structural guesses:** `threat_trajectories` (I'd flagged L1-SUSPECT) is actually **L2 public** MITRE/CERT archetypes — the per-tenant data lives in `trajectory_positions` (client_id); and `saved_knowledge_nuggets` (public tradecraft content) is **L1 user-owned** because of `user_id` + `saved_from_route`.
6. **The cross-tenant aggregation pipeline is real and structurally sound:** `signals → agent_learning_sessions[session_type='cross_tenant_aggregation', source_count≈1000, promoted_to_global=true] → global_learning_insights`. It produces genuinely anonymized category trends — but has **no k-anonymity floor** (low-count categories in a small fleet are weakly attributable).
7. **`watchdog_learnings` = L3** (platform self-health telemetry; not tenant-derived, not tenant-facing).

## Layer Classification Matrix
| Store (row-class) | Rows | Purpose | Content origin | Sample evidence | Identity-leak risk | Reconstruct risk | Final layer | Confidence |
|---|---|---|---|---|---|---|---|---|
| **agent_beliefs** [`entity_narrative`] | 114 | per-client entity narrative | tenant signals (client_id + signal FKs) | "Petronas Canada… environmental litigation" + 10 signal UUIDs | **HIGH (names client)** | **HIGH (signal FKs)** | **L1 raw tenant-derived** | High |
| **agent_beliefs** [all other 200+ types] | 15,418 | generic agent knowledge | generic/world knowledge (client_id NULL) | "Polymorphic malware…", "CNNs…" | None | Low (verify text) | **L2 transformed-anon** | Med-High |
| **global_learning_insights** [`world_expertise`] | 1,272 | public practitioner/academic knowledge | world_knowledge_engine (tenant_count=0) | "Michael Chertoff influence on risk mgmt" | None | None | **L2 public** | High |
| **global_learning_insights** [`ai_meta_insight`/`signal_category_trend`] | 187 | platform-wide category trends | cross-tenant signal aggregation | "'protest' signals 82 occurrences" | Low (small-count) | Low | **L2 transformed-anon — CONDITIONAL (k-anon); L1 until enforced** | Medium |
| **expert_knowledge** | 4,659 | curated security knowledge | world_knowledge_engine (source_id NULL all rows) | "MITRE ATT&CK v18 Detection" | None | None | **L2 public** | High |
| **signal_pattern_contributors** | 752 | signal→pattern membership index | tenant signal FKs | bare signal UUIDs only | High (resolves to signal content) | **HIGH** | **L1 raw tenant-derived** | High |
| **watchdog_learnings** | 567 | platform self-health diagnostics | system telemetry | "Zero Recent Signals", {openBugs:10} | n/a (platform-internal) | None | **L3 operator-only** | High |
| **universal_learning_log** | 262 | feedback→learning audit log | tenant feedback FKs | "category:community_outreach, reason:noise" + feedback_event_id | Med (FK) | Med (FK→tenant feedback) | **L1** (anon projection promotable to L2) | Medium |
| **agent_learning_sessions** [`cross_tenant_aggregation`] | ⊂133 | cross-tenant category aggregation | ≈1000 signals aggregated | category trend counts | Low | Low | **L2 transformed-anon — CONDITIONAL (k-anon)** | Medium |
| **agent_learning_sessions** [`proactive`] | ⊂133 | external research learning | public research topics | "MITRE ATT&CK research 2025/26" | None | None | **L2 public** | High |
| **expert_profiles** | 71 | public expert registry | curated public figures | "Marcus Luttrell", "Evan Zinger" | Low (verify none are tenant execs) | None | **L2 public** | Med-High |
| **saved_knowledge_nuggets** | 52 | user-saved knowledge clips | user_id + public methodology | Minto/Heuer tradecraft; `saved_from_route:/signals` | Low (user/route reveal) | Low | **L1 user-owned** (content L2-promotable via curation) | Medium |
| **knowledge_base_articles** | 18 | platform help/docs | internal product docs | "Signal Severity Levels" | None | None | **L2 public** | High |
| **source_credibility_scores** | 18 | source reliability scoring | aggregate confirm/refute over signals | "BC Energy Regulator → 0.52" | Low (public source names) | None (no tenant link) | **L2 transformed-anon** | High |
| **world_knowledge_sources** | 15 | external source registry | public URLs | "MITRE ATT&CK", "CISA KEV" | None | None | **L2 public** | High |
| **sequence_patterns** | 11 | detection heuristics | hand-authored generic | "protest_escalation" keyword list | None | None | **L2 transformed-anon** | High |
| **threat_trajectories** | 8 | threat archetypes | MITRE/CERT public frameworks | "APT Intrusion Lifecycle" (src: MITRE) | None | None | **L2 public** (corrected from L1-SUSPECT) | High |
| **trajectory_phases** | 8 | phases of archetypes | public frameworks | phases of the above | None | None | **L2 public** | High |
| **doctrine_library / doctrine_documents** | 0 | doctrine | — | EMPTY | — | — | **UNKNOWN → L1 until populated+audited** | n/a |
| **cross_tenant_patterns** | 0 | aggregate patterns | — | EMPTY | — | — | **UNKNOWN → L1** (aggregate-by-design → likely L2-conditional when populated) | n/a |
| **global_chunks / global_docs** | 0 | global RAG corpus | — | EMPTY | — | — | **UNKNOWN → L1** — ⚠ **HIGH RISK at populate-time** if fed uploaded tenant docs (INC-DOC-002 class) | n/a |
| **incident_knowledge_graph** | 0 | incident graph | — | EMPTY | — | — | **UNKNOWN → L1** — almost certainly L1 when populated (built from incidents) | n/a |
| **false_positive_patterns** | 0 | per-client FP patterns | — | EMPTY (has client_id col) | — | — | **UNKNOWN → L1** (client_id-scoped; anon-promotable) | n/a |
| **playbooks / learnings** | 0 | reusable playbooks / misc | — | EMPTY | — | — | **UNKNOWN → L1 until populated+audited** | n/a |

## Architectural rulings (feed the 3-layer ADR + R1 seam)
- **R-L2.1 — No table-granularity L2 grants.** `globalLearning()` must read L2 through **curated views/projections**, not raw tables. Each view: (a) filters to the L2 row-class (e.g., `agent_beliefs WHERE belief_type <> 'entity_narrative' AND client_id IS NULL`; `global_learning_insights WHERE insight_type='world_expertise'`), (b) **strips reconstruction FKs** (`contributing_signal_ids`, `feedback_event_id`, `pattern_signal_id`, `source_tenant_count`), (c) applies a **k-anonymity floor** to aggregate counts.
- **R-L2.2 — Confirmed L2 set (safe to expose now via the above views):** `expert_knowledge`, `expert_profiles`, `knowledge_base_articles`, `world_knowledge_sources`, `source_credibility_scores`, `sequence_patterns`, `threat_trajectories`/`trajectory_phases`, `global_learning_insights[world_expertise]`, `agent_beliefs[non-entity_narrative]`, `agent_learning_sessions[proactive]`.
- **R-L2.3 — Conditional L2 (gated on k-anon floor; until then L1):** `global_learning_insights[ai_meta_insight/signal_category_trend]`, `agent_learning_sessions[cross_tenant_aggregation]`. Define floor (e.g., suppress category counts where N<10 or contributing-tenants<3).
- **R-L2.4 — Hard L1 (never expose cross-tenant):** `agent_beliefs[entity_narrative]`, `signal_pattern_contributors`, `universal_learning_log`, `saved_knowledge_nuggets`.
- **R-L2.5 — L3:** `watchdog_learnings`.
- **R-L2.6 — Populate-time gate for empty stores:** `global_chunks`/`global_docs`/`incident_knowledge_graph` must be content-audited the moment they receive rows; default-deny to L1 until then. Add to the L2 CI guard.
- **R-L2.7 — Text-scan residual:** the 15,418 `agent_beliefs[non-entity_narrative]` rows were spot-checked generic; before promotion, run a name-scan for stray client/entity/exec strings in `hypothesis` (an L2-eligible row that *mentions* a tenant by name in free text is still L1).

---

# RATIFICATION-GRADE SCAN RESULTS (2026-05-27) — content scan vs identity dictionary

**Method:** built an identity dictionary from L1 (clients: Petronas Canada/PECL, Cascade Energy, BC Place/PavCo, Trent Reznor; tenants: Critical Risk Team, Silent Shield; assets: Coastal GasLink, LNG Canada, Pacific Gateway, Northern Reach, Cedar LNG, Prince Rupert Gas, Progress Energy; tenant-linked locations: Kitimat, Montney, Fort St. John, Dawson Creek, Bulkley, Skeena, Smithers) and regex-scanned every proposed free-text L2 row class.

**Three ratification tests:** (1) **Identity** — no tenant/client/user identifying content; (2) **Reconstruction** — no FK/join path back to L1; (3) **Attribution** — insufficient cardinality for origin inference (k-anon: suppress if contributing_tenants<3 OR contributing_events<10). If uncertain → L1.

### Scan results
| Store (row-class) | Distinctive-identifier hits | Verdict | Evidence |
|---|---|---|---|
| `agent_beliefs[non-entity_narrative, client_id NULL]` | **49 / 15,418** | **FAILS identity → L1** | client-null `geographic_risk` rows name client posture: *"Petronas faces increased reputational risk due to its LNG Canada Phase 2 expansion"*. The `client_id IS NULL` split is INSUFFICIENT. |
| `expert_knowledge` | **17 / 4,659** | **FAILS identity+reconstruction → L1** | contains **ingested tenant document titles**: *"Risk Assessment: Petronas - Security Awareness Report - Apr 17 2026.pdf"*, *"Increased Reputational Risk for PECL"*, region-keyed theft analyses (Fort St. John/Kitimat). Prior HIGH-confidence L2-public was WRONG. |
| `global_learning_insights[world_expertise]` | (⊂2) | **FAILS identity → L1** | a `world_expertise` row = *"[ANALYTICAL_CONCLUSION] Risk Assessment: Petronas… LNG Canada's Phase 2"*. `insight_type` label is not a reliable origin signal. |
| `global_learning_insights[ai_meta/category_trend]` | 0 distinctive | **L1 (conditional pending real anon + k-anon)** | category counts clean of distinctive terms, but same contaminated pipeline; do not trust the label. |
| `agent_learning_sessions` | **0 / 133** | proactive=**L2 public**; cross_tenant_aggregation=**L1 conditional** | no distinctive hits; aggregates are category counts. |
| `expert_profiles` | **0 / 71** | **L2 public** | public figures; passes all three tests. |
| `knowledge_base_articles` | 2 / 18 (NOT leaks) | **L2 public** | hits are platform docs ("Clients — the Tenant Boundary", NAAD/wildfire feeds) — no tenant specifics. |
| `source_credibility_scores` | n/a (structured) | **L2 transformed-anon** | public source names + aggregate counts; attribution caveat: a source used by a single tenant is weakly attributable — acceptable for reliability scoring. |
| `sequence_patterns` / `threat_trajectories` / `trajectory_phases` / `world_knowledge_sources` | n/a (structured/curated) | **L2 public** | hand-authored heuristics / MITRE-CERT archetypes / public URLs. |

### Root-cause finding (escalation — bigger than read-scoping)
**The cross-tenant learning pipeline contaminates the shared layer at WRITE time.** Two mechanisms confirmed:
1. **Tenant document ingestion into "global knowledge"** — uploaded tenant PDFs (*"Petronas - Security Awareness Report"*) land in `expert_knowledge` / `global_learning_insights` with their titles + risk content intact, labeled as world expertise.
2. **AI beliefs synthesized from tenant signals, stored client-null** — agents write tenant-specific risk assessments (Petronas/LNG Canada) into `agent_beliefs` with `client_id = NULL` and generic `belief_type`.

Read-scoping (R1/R2) is therefore **necessary but not sufficient**: the L2 stores must also be **cleaned** (existing contaminated rows quarantined/re-derived) and an **anonymization + identity gate must run BEFORE any write to a global-shared store**. This is an INC-XTEN-class provenance violation located in the learning pipeline.

### Ratification-grade L2 matrix (FINAL)
- **L2 — RATIFIED (passes all three tests; structured/curated-public):** `expert_profiles`, `knowledge_base_articles`, `source_credibility_scores`, `sequence_patterns`, `threat_trajectories`/`trajectory_phases`, `world_knowledge_sources`, `agent_learning_sessions[proactive]`.
- **L2 — REJECTED → L1 (failed identity/reconstruction on live data):** `expert_knowledge`, `global_learning_insights` (ALL classes incl. world_expertise), `agent_beliefs` (ALL classes). These hold confirmed tenant facts; no column/label filter is sufficient — only a per-row content-identity gate + pipeline cleanup can promote them later.
- **L1 — confirmed (unchanged):** `agent_beliefs[entity_narrative]`, `signal_pattern_contributors`, `universal_learning_log`, `saved_knowledge_nuggets`.
- **L3:** `watchdog_learnings`.
- **UNKNOWN → L1 (empty; populate-time gate):** the 9 empty stores; `global_chunks`/`global_docs`/`incident_knowledge_graph` are highest-risk.

**The free-text "learning" stores that are the WHOLE POINT of cross-tenant learning (`expert_knowledge`, `global_learning_insights`, `agent_beliefs`) currently FAIL the trust boundary.** Cross-tenant learning is not preserved by exposing them as-is — it requires building the anonymization gate first, then re-deriving clean L2 product.

**Evidence-based. No mutations. The 3-layer ADR remains UN-ratified — and now MUST NOT ratify these three stores as L2 until the learning-pipeline contamination is remediated.**

---

# INC-LEARN-CONTAM — P0 CONTAINMENT (DEPLOYED 2026-05-27) + FULL NER BLAST-RADIUS

## P0 containment — LIVE in prod (`dashboard-ai-assistant`, staging-validated then prod)
Default-deny on every Aegis path that reads the contaminated free-text shared stores:
1. **`CONTAINMENT_DISABLED_TOOLS` gate** at `executeTool` entry (takes precedence over the tenant gate) → honest refusal for **`get_global_learning_insights`, `get_cross_tenant_patterns`, `query_expert_knowledge`**.
2. **`query_fortress_data`** no longer surfaces `expert_knowledge` (`results.expert_knowledge = []`); `knowledge_base_articles` (passed L2) retained.
3. **Always-on prompt context** — the agent_beliefs load now restricts to **this tenant's own client beliefs only**; the `client_id IS NULL` branch (proven to carry Petronas/LNG-Canada facts) is suppressed; no-tenant/no-client loads nothing (was unfiltered).

**Not yet contained (flagged):** `submit_learning_insight` (WRITER into `global_learning_insights` — contamination *source*, not a disclosure path) and `getLearningPromptBlock`→`agent_learning_sessions[cross_tenant_aggregation]` (category aggregates, 0 distinctive hits, conditional-L2). Both belong to remediation, not the read-disclosure containment.
**Durability risk:** deployed but **not yet committed** — a `dashboard-ai-assistant` redeploy from clean `main` would revert containment. Must land in `main`.

## Full NER blast-radius (identity dictionary = 782 person + 1,216 org tenant-owned entities + 4 clients + 2 tenants + assets/locations)
| Store | Total | Person-name | Org-name | Distinctive client/asset/tenant | Tenant-sourced (definitional) | Confirmed contaminated | Note |
|---|---|---|---|---|---|---|---|
| **global_learning_insights** | 1,459 | 10 | 88 | 2 | 187 | **284 (19.5%)** — exact union | precise |
| **expert_knowledge** | 4,659 | 120 | (scan timed out) | 17 (incl. ingested tenant PDF titles) | n/a | **≥137 (≥2.9%)** | LOWER BOUND — org tier + full content matching raise it |
| **agent_beliefs** [client-null] | 15,418 | 34 | (not run) | 49 | n/a | **≥83 (≥0.5%)** | LOWER BOUND — org tier not run |

**Reading the numbers:** gli is the only exact figure (small enough to union without timeout) — **~1 in 5 rows is tenant-derived.** For `expert_knowledge`/`agent_beliefs` the exhaustive union times out, so the figures are **high-signal lower bounds** (person-name + distinctive-identifier only); the org-name tier alone on gli was ~9× its person tier, so the true `expert_knowledge` contamination is materially higher than 137 (its org scan timed out precisely *because* there were many matches to evaluate).

## Conclusion — contamination is pervasive and multi-vector
All three stores leak across **multiple independent vectors** (client names, person/org entity names, distinctive assets/locations, ingested document titles, definitionally tenant-sourced aggregates). **No single filter — column, label, or term — cleans any of them.** Remediation requires:
1. **Write-time anonymization + identity gate** in the learning pipeline (the doc-ingestion→expert_knowledge path, the agent belief-synthesis writer, `submit_learning_insight`) — stop new contamination first.
2. **Per-row identity gate (NER vs the full tenant dictionary)** as the L2 read-eligibility test — not column/label filters.
3. **Re-derivation** of clean L2 product from anonymized inputs; quarantine the existing contaminated rows.

Until 1–3 land, `expert_knowledge` / `global_learning_insights` / `agent_beliefs` stay **L1 + read-disabled** (contained).
