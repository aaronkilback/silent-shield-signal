# Fortress Program Readiness Review — 2026-05-30

**Status:** Operator-requested program-level assessment. Evidence only. No proposals, no new features, no implementation, no branch, no code, no migrations.

**Scope:** All completed audits, fixes, investigations, deployments, tenant-isolation work, CRT onboarding, BC Place / FIFA proposal work, learning-system investigations, and production findings as of 2026-05-30.

**Tenant landscape (evidence):**

| Tenant | Type | Clients | Investigations | Signals (7d) |
|---|---|---:|---:|---:|
| Silent Shield Operations (`feff5c44…`) | Operator / Platform | 7 (incl. Petronas Canada) | 2 | 99 |
| Critical Risk Team / **CRT** (`0aaaaaaa…`) | Customer (active) | 2 (BC Place / FIFA Vancouver, Trent Reznor) | 3 | 31 |
| `_invariant_tenant_a/b` (`11111111…`, `22222222…`) | Test isolation fixtures | 1 + 1 | 1 + 1 | 0 |
| `_legacy_test_tenant_2026_03_12`, `_qa_cipher_test_tenant` | QA / legacy | 0–1 | 0 | 0 |

---

## §1 — Tenant Isolation

### Proven fixed (with evidence)

| Item | Evidence |
|---|---|
| `ai_assistant_messages` open-SELECT vulnerability (`auth.uid() IS NOT NULL` exposed all chats to any authed user) | Prod migration `20260525011255` applied. RLS policy tightened to `tenant_id IN (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.user_id = auth.uid())`. Per `project_ai_messages_rls_isolation` memory. |
| INC-XTEN Track A — operator-authorized Petronas backfill + tenant-scoped RLS | Task #16 completed. Provenance Doctrine ratified 2026-05-26 per CLAUDE.md. |
| `useRealtimeNotifications` cross-tenant leak (INC-CRT-VISIBILITY) | Task #22 completed. |
| `sources` UI-filter hiding newly-created tenant-owned sources (INC-CRT-VISIBILITY) | Task #23 completed. |
| `get_recent_signals` cross-tenant + fixture leak | Commit `53f46209` 2026-05-30. CLAUDE.md doctrine violation closed. |
| C.0 (G2) canonical workspace tenancy on `investigation_workspaces` | Deployed prod 2026-05-30 PR #67. 7/7 functional tests on staging + prod. F3 (service-role spoofing) closed at workspace layer. |
| C.1 (G2) `cop_timeline_events.tenant_id` + child trigger + audit | Deployed prod 2026-05-30 PR #69. 8/8 functional tests. F5 (stale denorm) closed via nightly drift RPC + cron + alert table. |
| C.2 helper + CI guard (`cop-timeline-writer-discipline`) | Staging + CI deployed. Pure-Node regex guard active on every PR. |
| `agent-chat` `create_signal` / `create_entity` / `create_incident` hardening (INC-XTEN follow-on) | Task #18 completed. |
| Signal-feedback service-role tenant filter (per `feedback_tenant_isolation_checklist` memory) | `queryInvestigations` leak fixed 2026-05-20; pattern adopted as durable rule. |
| `signal_agent_analyses` retrieval tenant-scoped in `generate-daily-briefing` | Task #60 completed (Layer 1 fix, operator-approved). |
| `recordAgentMemory` fail-closed (refuse ownerless writes; INC-OMCR-1) | Task #36 completed. |
| 1,079 ownerless `agent_investigation_memory` rows backfilled/quarantined (INC-OMCR-2) | Task #37 completed. |
| All cross-agent / embedding retrieval primitives scoped (INC-OMCR-3) | Task #38 completed. |
| Runtime prompt/retrieval instrumentation `debug_trace_id` end-to-end (INC-OMCR-4) | Task #39 completed. Aegis Flight Recorder operational prod 2026-05-27 PR #25/#26. |
| Class A `agent_beliefs` legacy split → `agent_tradecraft` + `agent_tradecraft_quarantine` | 15,418 legacy rows migrated, prod-applied. P3 shadow population + rollback verification operator-approved (#67 task). |

### Remains unverified

| Item | Evidence |
|---|---|
| Frontend personal-view tenant scoping completeness | `project_ai_messages_rls_isolation`: "frontend personal-view tenant scoping still open." Reads beyond `ai_assistant_messages` not exhaustively audited. |
| `learning_profiles` reader fan-out (13 sites across 11 functions) | Phase 0 audit 2026-05-30. Only 1 of 13 reads filters by `tenant_id` (`process-intelligence-document:418`). Because `learning_profiles` is empty today, no current leak surface — but the readers will leak the moment writes succeed. |
| Frontend reads of `learning_profiles` (5 React components + `e2eTests.ts`) | Phase 0 audit 2026-05-30. Not audited line-by-line; may inherit auth tenant scope, but unconfirmed. |

### Known risks remaining (open)

| Risk | Evidence | Containment |
|---|---|---|
| **INC-XTEN Track B** — provenance contract + creation-path inventory + controls (closure) | Task #17 pending | Track A closed; doctrine ratified; Track B is the structural completion |
| **INC-XTEN sibling sweep** — open-RLS + ownerless artifact tables/buckets | Task #19 pending | Provenance Doctrine forbids; enforcement gap |
| **INC-XTEN-class ownerless `executive_intelligence` reports** | Task #53 pending. `tenant_id IS NULL` on rows. | Active reports still emit ownerless rows |
| **INC-CTX-CONTAM (BC Children's Hospital Gender Clinic)** | `project_inc_ctx_contam` memory: 82% ownerless `agent_investigation_memory` + unscoped `match_cross_agent_memories` RPC. **Real surface; not parametric.** | Containment in place (read-disabled stores frozen); the phrase IS still stored in ownerless memory + Petronas doc and accessible via the unscoped RPC. Not closed. |
| **INC-LEARN-CONTAM** — tenant facts in `expert_knowledge` / `global_learning_insights` / `agent_beliefs` | `project_inc_learn_contam` memory: stores READ-disabled + WRITE-frozen via triggers `trg_inc_learn_contam_freeze_*` | Frozen, not cured. Cannot be lifted without anonymization gate. |
| **INC-AEGIS-TRUST** — Aegis perception tenant-isolation leaks (P0) + 4 Vince root causes | Task #24 pending | Class still open |
| **INC-CRT-DOCUMENT-SCOPE** — tenant documents not retrievable / mis-scoped | Task #30 pending | Customer-facing |
| **Class B Provenance gap** across 18 LLM-derived analysis stores | `project_llm_derived_stores_provenance_class` memory: `agent_beliefs` 99.3% NULL ownership, `agent_debate_records` 90.5% NULL. PR #48 class-level reframing. Schema work held alongside PR #36. | Not closed; subject to nullable-owner / RLS-not-forced gaps |
| **`learning_profiles` reader fan-out latent leak** | Phase 0 finding 2026-05-30 | No current surface (table empty); becomes active surface on any successful write |

### Aggregate posture

**Stronger than 30 days ago.** Major class doctrines ratified (Provenance, Aegis Authority & Memory, Grounding-State). Multiple concrete remediations shipped. Persistent gaps in: (a) ownerless legacy artifact classes, (b) ungrounded Aegis retrieval surfaces, (c) reader-side scoping in the analysis-store family. **Not fully proven across all classes.**

---

## §2 — CRT Readiness

CRT is the active customer tenant (`0aaaaaaa-cccc-4444-bbbb-000000000001`) with 2 clients (BC Place / FIFA Vancouver, Trent Reznor) and 3 open investigations.

### Capabilities CRT can use today (production-ready for this tenant)

| Capability | Evidence |
|---|---|
| Signal ingestion + display (per-tenant feed) | 31 signals / 7d on CRT (live SQL). Tenant-scoped reads enforced. |
| Investigation creation + editing (incl. C.4 `next_review_at` capability) | C.4 prod-deployed 2026-05-30 PR #76; capability verified GREEN. 3 CRT investigations exist. |
| Entity intelligence + monitoring | Per CLAUDE.md client-agnostic monitor design; per-entity `monitoring_keywords`. |
| Signal feedback capture (Path B → agent prompt evolution) | `feedback_events` writes succeed; `apply-feedback-to-agent` enqueue path alive (83 `self_improvement_log` rows / 30d). |
| AI relevance gate (baseline calibration) | Detection Health Assessment 2026-05-30: 146 signals across 11 categories / 7d total platform-wide; CRT 31. |
| Cross-domain category propagation (relevance scorer hardcoded) | Hardcoded `RELATED_CATEGORIES` map per `process-feedback` lines 651-666. |
| MFA enforcement (SMS OTP for all users incl. CRT) | CLAUDE.md 2026-04-22: removed role check in `Auth.tsx`. |
| Client authorization OTP gate for vulnerability scans | CLAUDE.md 2026-04-15: skip button removed; compliance gate required. |
| Wildfire monitoring (CWFIS hotspots + lightning + flaring classifier) | Operational; signals admitted to CRT if relevant to its locations. |

### Pilot-only / pre-production

| Capability | Evidence |
|---|---|
| C.4 commitment-data capture (`next_review_at`) | Deployed 2026-05-30. **Adoption window active, closes ~2026-06-27.** No adoption claim yet per operator-locked capability-vs-adoption split. |
| Workstream D claim-frame UI (confidence + provenance layers) | Prod-applied 2026-05-28 PRs #38/#39/#40 but **dark behind `D_SLIM_SLICE_ENABLED` flag.** |
| `agent_tradecraft` retrieval injection | Prod-applied; relevance retrieval (keyword) cutover complete. Effectiveness under continued observation. |

### Known limitations affecting CRT

| Limitation | Evidence |
|---|---|
| **Bimodal investigation engagement** | BC Place 2 investigations / 0% synopsis populated / 0% recommendations / 0% correlated entities. Trent Reznor 1 investigation / 0% synopsis. Compare Petronas 2/2 = 100% synopsis (different tenant). |
| **INC-CTX-CONTAM phrase surface still active** | The "BC Children's Hospital Gender Clinic" phrase is stored in ownerless memory + a Petronas doc; the unscoped `match_cross_agent_memories` RPC can return cross-tenant rows. Aegis tenant retrieval may surface non-CRT content. Containment is freeze-based, not eliminated. |
| **`learning_profiles` empty** | CRT analyst feedback recorded in `feedback_events` and Path B agent prompts, but Path A statistical adaptation = zero. |
| **AI gate operates on baseline calibration for CRT** | `signal-relevance-scorer` reads empty `learning_profiles` → falls back to hardcoded `suppress=0.45`, `low_conf=0.65`. No CRT-specific tuning. |
| **INC-CRT-DOCUMENT-SCOPE open** | Task #30 pending — tenant documents not retrievable / mis-scoped. Customer-facing. |
| **Cross-tenant retrieval exclusivity not fully implemented** | Aegis Authority Doctrine Amendment requires all cross-tenant retrieval through audited Aegis Ops seam. Tenant code uses `tenantRetrieve()` + `globalLearning()` only. **Seam not built.** |
| **Aegis Operational State Integrity (C/D/E/F) — F-stage execution DISABLED** | Grounding-State Doctrine 2026-05-27 INC-CTX-CONTAM. Aegis cannot execute actions on tenant artifacts until grounding + provenance + traversal integrity is fully trustworthy. |
| **Watchdog stale-learning alarm** | Triggers but the "feedback events exist but learning_profiles haven't updated in 48h" check understates the problem (it's never updated). Not gating customer ops. |

### CRT-specific evidence anomalies

| Anomaly | Evidence |
|---|---|
| BC Place investigations created 2026-05-20, no engagement since 10+ days | `project_decision_layer` memory + prod SQL inspection 2026-05-30 |
| BC Place tenant retrieval can surface BCH Gender Clinic phrase | INC-CTX-CONTAM forensics |
| Cross-tenant pattern bleed risk on Path A reactivation | Phase 0 audit shows 12/13 readers unscoped |

---

## §3 — BC Place / FIFA Readiness

BC Place / FIFA Vancouver is a CRT-owned client (`0bbbbbbb-cccc-4444-bbbb-000000000002`).

### Capabilities supporting the proposed scope today

| Capability | Evidence |
|---|---|
| Signal ingestion + display | Active. CRT 31 signals/7d aggregate. |
| Entity monitoring | Client-agnostic monitor functions per CLAUDE.md. |
| Investigation workflow (incl. C.4 next-review-date capture) | Available; 2 BC Place investigations exist. |
| Wildfire monitoring (if relevant to BC Place locations) | Operational platform-wide. |
| News + social monitoring per-entity name queries | `monitor-news-google` adds per-entity-name queries (CLAUDE.md April 23). |
| Reporting: POI / Investigation Report, Fortress Report, Daily Briefing | Generators alive. Workstream D claim-frame integration in progress (single surface). |
| BC Place / FIFA staging↔prod parity audit | Task #52 completed (10 axes; data evidence before conclusions). |
| Retrieval-boundary audit: BC Place exec-intel report inside CRT tenant | Task #54 completed (relevance not isolation). |

### Gaps relevant to BC Place / FIFA scope

| Gap | Evidence |
|---|---|
| **BC Place investigation adoption is shell-only.** 2 investigations open 10+ days, 0% synopsis populated, 0% recommendations, 0% correlated entities. | Prod SQL 2026-05-30. The system has detection running but the operator workflow on BC Place has not yet been exercised. |
| **Path A learning loop empty.** Per-tenant relevance gate adaptation off. | Phase 0 finding 2026-05-30. |
| **INC-CTX-CONTAM phrase surface still surfaces BCH Gender Clinic via unscoped match RPC** | Containment in place; not closed. |
| **Cross-tenant retrieval exclusivity seam not built.** Aegis tenant calls do not yet route through the audited Aegis Ops seam. | Aegis Authority & Memory Doctrine 2026-05-27 ratified but partially implemented. |
| **Workstream D claim-frame UI dark.** Reports being generated for BC Place do not have user-visible confidence/provenance layers until flag flipped. | PRs #38/#39/#40 dark behind `D_SLIM_SLICE_ENABLED`. |
| **Aegis Operational State Integrity F-stage (action execution) DISABLED.** | Grounding-State Doctrine 2026-05-27. Aegis cannot execute actions on BC Place artifacts. |
| **Class B Provenance gap on LLM-derived analysis stores affects BC Place outputs** | `agent_beliefs` 99.3% NULL ownership — analysis content for BC Place may surface in cross-tenant retrieval if Class B isn't closed. |
| **Frontend tenant-scoping for some read surfaces unverified** | `project_ai_messages_rls_isolation` notes "frontend personal-view tenant scoping still open." |

### Risks that could impact delivery

| Risk | Severity | Evidence |
|---|---|---|
| BC Place engagement remains shell-only through proposal window | MEDIUM (per `project_decision_layer` bimodal finding) | 0% synopsis populated on existing investigations |
| INC-CTX-CONTAM phrase appears in customer-facing demo / report | HIGH (customer trust) | Real storage surface; not closed |
| Cross-tenant retrieval leak via unscoped RPC during demo | HIGH (customer trust) | `match_cross_agent_memories` unscoped per `project_inc_ctx_contam` |
| Workstream D dark flag not flipped → reports lack provenance UI | LOW–MEDIUM (perception) | Flag-gated; operator GO required |
| Detection on BC Place / FIFA specific keywords inadequate | LOW–MEDIUM | Requires `monitoring_keywords` + `active_monitoring_enabled` audit per CLAUDE.md |
| Path A learning broken → repeated false positives not suppressed for BC Place | LOW (current); MEDIUM at scale | Phase 0 + Impact Assessment 2026-05-30 |
| Aegis surfaces ungrounded specifics in BC Place tenant view | MEDIUM | Grounding-State Doctrine; F-stage disabled until trustworthy |

---

## §4 — Aegis

### Operational today (evidence-based)

| Capability | Evidence |
|---|---|
| Tenant intelligence retrieval baseline (R1.0 schema deployed) | PR #61 prod-applied 2026-05-29. Zero behavioral effect. |
| Aegis Flight Recorder | Operational prod 2026-05-27 PR #25/#26. `aegis_trace_replay()` operator-only; reconstructs prompt→retrieval→tools→grounding→response. Only `dashboard-ai-assistant` wired. |
| Decision Layer Doctrine | Ratified 2026-05-29 PR #58 v2 + R1 ADR PR #59 + Q1-Q10 PR #60. Operator-locked invariants I1 (statistical noise ≠ frame) / I2 (quiet commitment-invalidating event ≠ excluded). |
| Workstream D — confidence + provenance | Slim slice prod-applied 2026-05-28 PRs #38/#39/#40. Four-question frame (Fact/Inferred/Confirmed/Hypothesis/Stale headline). Six-axis drill-down. Prose-lint R1-R6. Append-only audit table. Ships dark behind `D_SLIM_SLICE_ENABLED`. |
| Agent tradecraft retrieval (Class A) | Prod-applied; keyword retrieval RPC + threshold calibration complete. Tradecraft-enhanced responses validated across 5 scenarios. |
| Operational-intelligence phase ADR | Ratified 2026-05-28 PR #37. Four workstreams (A/B/C/D). |
| C.0 + C.1 + C.2 + C.3 + C.4 (commitment-inventory data scaffolding) | All deployed prod 2026-05-30. |

### Experimental / dark / partial

| Capability | State |
|---|---|
| Workstream D claim-frame UI | Prod-applied but dark behind `D_SLIM_SLICE_ENABLED` |
| Decision Layer R1.1 (C1 threshold detector) | Locked behind §11 inventory re-run gate (4-week observation window) |
| Decision Layer R1.2–R1.7 (C2/C3 detectors + aggregator + audit + tuning + handoff) | Sequentially gated behind R1.1 |
| Decision Layer R2–R6 (post-detection: approval / execution / etc.) | Locked; F-stage execution DISABLED per Grounding-State Doctrine |
| Aegis Unified Retrieval & Intelligence Graph | TOP architecture priority (task #33 in_progress) |
| Aegis Operational State Integrity (C/D/E/F) | Pending (task #34) — F (execution) explicitly DISABLED |
| Aegis Authority Modes ADR (two identities; no impersonation) | Pending (task #28) |
| Aegis Ops control plane (operator mutating authority) | Pending (task #29) |
| Workstream A (canonical review workflows) | Pending design ADR |
| Workstream B (intelligence graph operationalization) | Pending design ADR |
| Workstream C (Aegis operational reasoning) | Pending design ADR |

### Unresolved dependencies

| Dependency | Evidence |
|---|---|
| Cross-tenant retrieval exclusivity seam | Doctrine ratified; seam not built |
| Certified-safe retrieval allowlist (`CERTIFIED_TENANT_SURFACES`) | Spec exists; allowlist not enumerated |
| Grounding-state assertions on every factual claim | Doctrine ratified; runtime enforcement partial |
| INC-LEARN-CONTAM remediation (frozen stores) | Containment only; anonymization gate not built |
| INC-AEGIS-TRUST P0 perception leaks (4 Vince root causes) | Pending (task #24) |
| INC-AEGIS-ACTION-INTEGRITY capability truthfulness | Pending (task #26) |
| Path A learning loop | Broken (Phase 0 finding) — Aegis-adjacent statistical learning offline |
| §11 inventory re-run | 4-week wait; gates R1.1 |

---

## §5 — Executive Briefing Workflow

### Current maturity

| Surface | State |
|---|---|
| `send-daily-briefing` | LIVE; cron `send-daily-briefing-13utc` active in pg_cron |
| `generate-daily-briefing` | LIVE; signal_agent_analyses retrieval **tenant-scoped 2026-05-30** (task #60 Layer 1 fix, operator-approved) |
| `briefing-feedback` | LIVE; receives feedback via email link; recorded but **not consumed by any downstream learning** (impact assessment 2026-05-30) |
| Audio briefing | Function exists; `aggregate-implicit-feedback` referenced |
| Travel briefing / alert | Per CLAUDE.md `assess-entity` / travel paths |
| Executive Intelligence Brief (canonical target structure) | Referenced as the convergence target for Report Generator Standardization (backlog item 2026-05-30) |

### Known gaps

| Gap | Evidence |
|---|---|
| **INC-LEARN-CONTAM-LEAK** — prompt-level injection of tenant-blind stores into report generators | Task #55 pending |
| **Forensic + remediation: Trent Reznor report methodology-injection** | Task #56 completed; **regenerate report using claim taxonomy** pending operator validation (task #51) |
| **Flash↔Narrative contradiction** | Investigated; signal-vs-threat separation proposed (task #57 completed). Implementation not yet authorized. |
| **Contamination-surface inventory** | Task #58 completed (pattern signals / methodology language / Flash-contradiction). Not yet fixed. |
| Briefing report uses LLM-derived analysis stores with 99.3% NULL ownership | `agent_beliefs` per `project_llm_derived_stores_provenance_class` |
| Path A learning not feeding briefing-relevant patterns | Phase 0 finding |
| Workstream D claim-frame UI dark on report rendering | `D_SLIM_SLICE_ENABLED` |
| Report Generator Standardization not initiated | Backlog only; Commander's Intent recorded |

### Production readiness

**Production-functional with known caveats.** Briefings ship, signal tenant-scoping fixed for the primary retrieval surface. Customer-visible weaknesses: contamination-surface inventory not remediated; methodology-injection cure not regression-validated on real customer report; provenance UI absent until flag flipped.

---

## §6 — Detection & Monitoring

### Working monitors (evidence)

| Monitor | Evidence |
|---|---|
| `monitor-news-google` | Live; per-entity name queries added April 23. Last 7d 146 signals platform-wide across 11 categories. |
| `monitor-social-unified` | Live; `monitoring_context` overrides; CSE-only fallback when Meta Graph off. |
| `monitor-rss-sources` | Live; OK in cron alignment audit. |
| `monitor-wildfires` | Live; tiered classifier (industrial flaring vs ambiguous_near_facility vs wildfire); lightning correlation; CWFIS hotspots. |
| `monitor-macro-indicators` | Cron OK. |
| `monitor-naad-alerts` | Cron OK. |
| `monitor-instagram-2h` | Live; 46 healthy runs since 2026-05-27; **0 signals/run** (closed OSINT channel, Meta Graph off — known structural). |
| `send-daily-briefing-13utc` | Live; daily UTC briefing. |
| `system-watchdog-daily` | Live; behavioral health phase added April 24. |
| `snapshot-bcws-ratings-daily` | Live. |
| `proactive-intelligence-push-15min` | Live. |
| `resolve-agent-predictions-daily` | Live; 4 healthy runs since 2026-05-27; empty queue (no predictions to resolve). |
| `thread-weaver-2am` | Live. |

### Suspect / not working (evidence)

| Monitor | Issue | Evidence |
|---|---|---|
| `monitor-instagram-2h` | Zero signals lifetime via the current path | Meta Graph token off; CSE fallback structural zero-yield (memory `project_social_monitor_dryup`) |
| `monitor-threat-intel` | **Intentionally unscheduled** 2026-05-23 (#256 P0 cross-tenant misattribution containment) | Migration `20260524030000_256_p0_containment_unschedule_monitor_threat_intel.sql` |
| `monitor-community-outreach-hourly` | **Intentionally deactivated** 2026-05-21 (corpus poison: 49% rel-zero, 100% NULL source_url, junk content) | Migration `20260521000000_disable_community_outreach_cron.sql` |
| `monitor-twitter` | **Retired** 2026-05-22 PROD-M; 0 lifetime invocations; 30+ days inactive; X API budget pause | CLAUDE.md |
| `monitor-pastebin` | Allowlisted no-cron PENDING | Cron alignment audit |
| `optimize-rule-thresholds-weekly` | Declared in migration but missing from live pg_cron | Cron Schedule Alignment CI failure |
| `monitor-threat-intel` (live drift) | Declared but missing from pg_cron (intentional but flagged) | Same CI check |
| `monitor-community-outreach-hourly` (live drift) | Same | Same |
| `self-improvement-orchestrator` | Allowlisted no-cron PENDING | Cron alignment audit |
| `signal_agent_analyses` retrieval (in briefing) | Was unscoped → fixed 2026-05-30 (Layer 1) | Task #60 |
| **Path A learning** | Empty `learning_profiles`; signal-relevance-scorer + ingest-signal AI gate on baseline calibration | Phase 0 audit 2026-05-30 |
| **Feedback events propagation to learning_profiles** | 267 events / 30d → 0 rows in `learning_profiles` (lifetime) | Phase 0 audit 2026-05-30 |
| **`generate-learning-context`** | Dormant by env flag `FEEDBACK_LEARNING_PER_TENANT_ENABLED !== 'true'` | Code at line 12 |
| **`learn-from-investigations`** | Dormant (no cron, no callers) | Impact assessment 2026-05-30 |
| **`visibility-gap-scanner`** | Dormant | Same |
| **`monitor-news-google` recent signal collapse** | 2026-05-25 zero-signals alert; root cause PROD-S Track G 5-domain allowlist + empty tenant overlay | Memory `project_signal_collapse_news_allowlist` |
| Social monitor dry-up 2026-05-23/24 | AI-429 fail-open junk spike then structural CSE-only zero-yield | Memory `project_social_monitor_dryup` |

### Detection capability summary

**Detection IS occurring.** 146 signals / 7d across 11 active source categories. 99 signals/7d to Silent Shield Operations, 31 to CRT.

**Detection is NOT adaptive** — no statistical learning. Operates at baseline calibration.

**Three monitors are intentionally posture-restricted.** Two for tenant-isolation / containment reasons (threat-intel, community-outreach). One for budget (Twitter/X).

**One monitor is structurally dead** (Instagram via Meta Graph).

---

## §7 — Reporting

### Current state

| Generator | State |
|---|---|
| `generate-poi-report` | LIVE; strict sourcing rule enforced; live HIBP fallback; relationship injection from `entity_relationships` (CLAUDE.md). Claim-frame integration in progress (Workstream D follow-on, task #48 in_progress). |
| `generate-fortress-report` | LIVE; smoke-tested via `test-aegis-tools.mjs`. |
| `generate-wildfire-daily-report` | LIVE; user-triggered; rich HTML; FWI estimates; restriction matrix; AQHI. |
| `send-daily-briefing` | LIVE on cron. |
| `generate-daily-briefing` | LIVE; signal_agent_analyses retrieval tenant-scoped 2026-05-30. |
| `assess-entity` | LIVE; writes `ai_assessment`. |
| Executive Intelligence Brief (target) | Referenced; not consolidated. |

### Tenant-isolation status (report-generation specific)

| Surface | Status |
|---|---|
| `generate-daily-briefing` `signal_agent_analyses` retrieval | ✅ Tenant-scoped 2026-05-30 (Layer 1 fix) |
| `generate-poi-report` HIBP / relationships / sourcing | Reads tenant-scoped entity / relationships; no cross-tenant call surface identified |
| `executive_intelligence` reports | ❌ **Rows ownerless** — INC-XTEN-class task #53 pending |
| Aegis-injected report content | Partial — Grounding-State Doctrine ratified but enforcement runtime not complete |
| Report content sourced from `agent_beliefs` (99.3% NULL ownership) | ❌ Class B Provenance gap |

### Outstanding risks

| Risk | Severity | Evidence |
|---|---|---|
| **INC-XTEN-class ownerless executive_intelligence reports** | HIGH | Task #53; `tenant_id IS NULL` on rows |
| **INC-LEARN-CONTAM-LEAK** | HIGH | Task #55; tenant-blind stores injected into report generators |
| **Class B Provenance gap on `agent_beliefs` / `agent_debate_records`** | MEDIUM | `project_llm_derived_stores_provenance_class` |
| **Methodology-injection recurrence on customer reports** | MEDIUM (regression-prone) | Trent Reznor reported and cured; regeneration validation pending (task #51) |
| **Workstream D claim-frame UI dark** | LOW (perception) | `D_SLIM_SLICE_ENABLED` |
| **Report Generator Standardization not initiated** | LOW | Backlog only |

---

## §8 — Learning Systems

### Path A status

| Layer | State | Evidence |
|---|---|---|
| Writer (`upsertLearningProfile` + 6 other functions, 21 sites total) | **BROKEN** — all 21 sites omit `tenant_id NOT NULL` | Phase 0 audit 2026-05-30 |
| `generate-learning-context` bulk feeder (10 of 21 sites) | **DORMANT BY ENV FLAG** — `FEEDBACK_LEARNING_PER_TENANT_ENABLED !== 'true'` | Code at line 12 |
| `learn-from-investigations` (2 sites) | DORMANT (no cron, no callers) | Impact assessment 2026-05-30 |
| `visibility-gap-scanner` writes (2 sites) | DORMANT | Same |
| `briefing-feedback` writes (2 sites) | LIVE but counters not consumed | Same |
| `system-ops` (2 sites) | OPERATOR-TRIGGERED (admin action) | Same |
| `threat-cluster-detector` (1 site) | LIVE on-demand; nothing to decay since 0 rows | Same |
| Reader filter discipline (13 sites) | **BROKEN** — 12/13 readers unfiltered by `tenant_id` | Phase 0 audit |
| `learning_profiles` row count | **0 lifetime** | Prod SQL |
| `learning_feedback`, `signal_feedback` | 0 lifetime | Prod SQL |
| `feedback_events` | 267 / 30d, 1 / 7d (declining) | Prod SQL |
| `implicit_feedback_events` | 136 / 30d, 4 / 7d | Prod SQL |
| `universal_learning_log` | 225 / 30d | Prod SQL — logs *intent*, not result |

### Path B status

| Layer | State | Evidence |
|---|---|---|
| `apply-feedback-to-agent` queue path | LIVE | 83 `self_improvement_log` rows / 30d |
| `agent_configs.system_prompt` evolution | LIVE | Per-agent prompt injection working |
| `self_improvement_log` | 96 total / 83 in 30d | Prod SQL |

### Actual operational impact (from Impact Assessment 2026-05-30)

| Consequence | Severity |
|---|---|
| Per-tenant signal-relevance threshold adaptation | MEDIUM — hardcoded 0.45 / 0.65 defaults apply |
| AI gate analyst-feedback context | MEDIUM — empty pattern blocks in AI prompt |
| AEGIS-CMD behavioral calibration | LOW |
| Pattern aging / decay | NONE PRESENT (no patterns to decay) |
| Briefing quality tracking | NONE (recorded but never read) |
| Investigation workflow patterns | NONE (no consumers even if written) |
| Cross-domain propagation | NONE PRESENT (function dormant) |
| Operator mental-model accuracy | NOTABLE — operators may believe their feedback shapes detection more than it does |
| User-visible breakage | **NONE** — all functions return normally; no HTTP 500s; no toasts |

### Is repair currently justified?

**Based on Impact Assessment 2026-05-30:**

- Operational impact is moderate, not severe. Critical paths have functional fallbacks.
- Path B continues providing real adaptation via prompt evolution.
- Class-wide architectural change (C-class) required for true fix.
- C.4 adoption window competes for operator attention.

**Recommendation in Impact Assessment was B — Defer.** Decision pending operator GO/NO-GO.

---

## §9 — Production Risk Register

### P0 — blocks customer trust or deployment

| # | Risk | Evidence |
|---|---|---|
| P0.1 | INC-CTX-CONTAM phrase ("BC Children's Hospital Gender Clinic") may surface in CRT tenant view via unscoped `match_cross_agent_memories` RPC | `project_inc_ctx_contam` memory — real surface, not parametric |
| P0.2 | INC-XTEN-class ownerless `executive_intelligence` reports (rows with `tenant_id IS NULL`) | Task #53; doctrine violation; affects any executive briefing |
| P0.3 | INC-LEARN-CONTAM-LEAK: prompt-level injection of tenant-blind stores into report generators | Task #55; cross-tenant content can appear in customer reports |
| P0.4 | INC-AEGIS-TRUST: Aegis perception tenant-isolation leaks (P0) + 4 Vince root causes | Task #24 |
| P0.5 | INC-CRT-DOCUMENT-SCOPE: tenant documents not retrievable / mis-scoped | Task #30 — customer-facing |

### P1 — materially impacts operations

| # | Risk | Evidence |
|---|---|---|
| P1.1 | Path A learning loop broken class-wide (21 writer sites + 12/13 reader sites unscoped) | Phase 0 audit 2026-05-30 |
| P1.2 | Class B Provenance gap on 18 LLM-derived analysis stores (`agent_beliefs` 99.3% NULL, `agent_debate_records` 90.5% NULL) | `project_llm_derived_stores_provenance_class` |
| P1.3 | INC-AEGIS-ACTION-INTEGRITY: capability truthfulness remediation | Task #26 — Aegis may claim capabilities it doesn't have |
| P1.4 | INC-LEARN-CONTAM: shared-learning stores remain frozen — anonymization gate not built | `project_inc_learn_contam` |
| P1.5 | Aegis Operational State Integrity F-stage (action execution) DISABLED until grounding integrity trustworthy | Grounding-State Doctrine 2026-05-27 |
| P1.6 | Cross-tenant retrieval exclusivity seam not built — Aegis tenant calls do not route through audited Aegis Ops seam | Aegis Authority & Memory Doctrine Amendment |
| P1.7 | `generate-learning-context` env-flag gated off, even after writer fix would not restore bulk learning | Phase 0 + Impact Assessment 2026-05-30 |
| P1.8 | INC-XTEN Track B (provenance contract + creation-path inventory + controls) | Task #17 |
| P1.9 | INC-XTEN sibling sweep (open-RLS + ownerless artifact tables/buckets) | Task #19 |
| P1.10 | 3 missing pg_cron jobs (`optimize-rule-thresholds-weekly`, `monitor-threat-intel`, `monitor-community-outreach-hourly` — last two intentional but flagged) | Cron Schedule Alignment CI |
| P1.11 | Trent Reznor report methodology-injection regression-validation pending | Task #51 |
| P1.12 | Frontend personal-view tenant scoping unverified across non-chat surfaces | `project_ai_messages_rls_isolation` |

### P2 — important but can wait

| # | Risk | Evidence |
|---|---|---|
| P2.1 | C.4 adoption uncertain — base creation rate 1.2/week across 3 tenants | C.4 package §7 |
| P2.2 | BC Place investigation engagement shell-only (10+ days, 0% synopsis populated) | Prod SQL 2026-05-30 |
| P2.3 | Workstream A/B/C design ADRs not started | Tasks #42, #43, #44 |
| P2.4 | Aegis Unified Retrieval & Intelligence Graph TOP architecture priority — in_progress | Task #33 |
| P2.5 | Aegis Operational State Integrity (C/D/E/F) — not started | Task #34 |
| P2.6 | Aegis Authority Modes ADR (two identities; no impersonation) — not started | Task #28 |
| P2.7 | Aegis Ops control plane — not started | Task #29 |
| P2.8 | Aegis 3-Layer Memory ADR (Global Learning ≠ Global Visibility) — not started | Task #25 |
| P2.9 | Workstream D claim-frame UI dark behind `D_SLIM_SLICE_ENABLED` | PRs #38/#39/#40 |
| P2.10 | NAAD normalization / signal-quality hardening | Task #21 |
| P2.11 | Slice 2 (deferred): entity extraction backlog + discovery routing + Aegis review tools | Task #31 |
| P2.12 | Aegis tenant cross-asset intelligence retrieval (Phase K read surface) | Task #32 |
| P2.13 | `entity_relationships.validation_state` column (Workstream D follow-on) | Task #50 |
| P2.14 | G3 prod apply (PR #36) — operator GO pending | Task #41 |

### P3 — technical debt

| # | Risk | Evidence |
|---|---|---|
| P3.1 | Critical File Guard CI false-positive (`service_role` type literal) | Pre-existing on main since at least 2026-05-29 |
| P3.2 | Playwright E2E 5 pre-existing failures (auth.spec.ts, health.spec.ts, signals.spec.ts, super-admin-bootstrap.spec.ts) | Pre-existing on main |
| P3.3 | `resolve-agent-predictions-nightly` registry name drift (cron name is `-daily`) | Detection Health Assessment 2026-05-30 |
| P3.4 | `agent-chat` defects from C3: `create_signal` `source` non-column + `suggest_entity` dead guard | Task #20 |
| P3.5 | Watchdog "learning_profiles haven't updated in 48h" alarm logic — understates "never updated" reality | Phase 0 finding |
| P3.6 | Tier-2 review gap audit (67% reviewed; Track B2) | Task #11 |
| P3.7 | feedback→learning_profiles loop audit (Track B3) — superseded by Phase 0 | Task #12 |
| P3.8 | `generate-poi-report` Workstream D claim-frame wiring (single surface) | Task #48 in_progress |
| P3.9 | Backlog: Feedback Loop Restoration (Path A) — see authorization package | Backlog doc |
| P3.10 | Backlog: Report Generator Standardization — Commander's Intent only | Backlog doc |

---

## §A — Capability Inventory

### Production Ready

- Signal ingestion + tenant-scoped display
- Investigation workflow (incl. C.4 `next_review_at` capability post-deploy 2026-05-30)
- Wildfire monitoring (CWFIS hotspots + lightning + tiered flaring classifier)
- News monitoring (`monitor-news-google`)
- RSS monitoring (`monitor-rss-sources`)
- Wildfire daily report
- POI / Investigation report generator (with strict sourcing + HIBP + relationships)
- Fortress report generator (smoke-tested)
- Daily briefing pipeline (with tenant-scoped retrieval as of 2026-05-30)
- Signal feedback capture (Path B → agent prompt evolution)
- MFA enforcement (SMS OTP)
- Client authorization OTP gate
- Aegis Flight Recorder (operator-only `aegis_trace_replay`)
- Cron heartbeat + system-watchdog (behavioral health phase)
- Provenance Doctrine non-bypassable backstop (CHECK constraints on multiple stores)
- C.0 + C.1 + C.2 + C.3 + C.4 Decision-Layer scaffolding (no behavioral effect yet)
- `agent_tradecraft` Class A migration + keyword retrieval

### Pilot Ready (live but caveats)

- Workstream D claim-frame layers (dark behind `D_SLIM_SLICE_ENABLED`)
- C.4 `next_review_at` adoption (window active; capability GREEN, adoption unknown)
- Aegis tenant intelligence retrieval (operates with caveats — Grounding-State F-stage disabled; INC-CTX-CONTAM containment in place; INC-LEARN-CONTAM stores frozen)
- Decision Layer R1.0 schema (zero behavioral effect; awaits R1.1)
- BC Place / FIFA Vancouver delivery (capability present; engagement shell-only; INC-CTX-CONTAM phrase surface still active)

### Experimental

- Decision Layer R1.1+ detector path (locked behind §11)
- Workstream A/B/C design (ADRs not started)
- Aegis Unified Retrieval & Intelligence Graph (TOP architecture priority, in_progress)
- Aegis Operational State Integrity (C/D/E/F) — F (execution) explicitly disabled
- DGIC admission controller (Phase B slice 1 parity-green on branch; controller DISABLED, legacy authoritative)

### Dormant

- `generate-learning-context` (env-flag gated off)
- `learn-from-investigations` (no cron, no callers)
- `visibility-gap-scanner` (no cron, no callers)
- `monitor-twitter` (retired 2026-05-22; code preserved as inventory)
- `monitor-threat-intel` (intentionally unscheduled for containment)
- `monitor-community-outreach-hourly` (intentionally deactivated for corpus poison)
- `monitor-pastebin` (allowlisted no-cron pending)
- `self-improvement-orchestrator` (allowlisted no-cron pending)
- Aegis F-stage (execution) — explicitly disabled per Grounding-State Doctrine
- Decision Layer R2–R6 — all locked sequentially

---

## §B — Risk Register

| ID | Risk | Severity | Evidence | Recommended action (not authorized) |
|---|---|---|---|---|
| P0.1 | INC-CTX-CONTAM phrase surfaces in customer tenant view | P0 | `project_inc_ctx_contam`; ownerless memory + unscoped RPC | Eliminate the unscoped `match_cross_agent_memories` retrieval; backfill ownerless memory |
| P0.2 | Ownerless `executive_intelligence` rows | P0 | Task #53 | Schema hardening + writer-side tenant_id supply + backfill |
| P0.3 | INC-LEARN-CONTAM-LEAK in report generators | P0 | Task #55 | Block prompt-level injection of frozen stores |
| P0.4 | INC-AEGIS-TRUST P0 + 4 Vince root causes | P0 | Task #24 | Root-cause-by-root-cause closure |
| P0.5 | INC-CRT-DOCUMENT-SCOPE | P0 | Task #30 | Customer-facing repair |
| P1.1 | Path A learning broken class-wide | P1 | Phase 0 audit | FLR Path A authorization package exists; operator decision pending |
| P1.2 | Class B Provenance gap on 18 stores | P1 | `project_llm_derived_stores_provenance_class` | PR #48 reframing exists; PR #36 holds Class B schema work |
| P1.3 | INC-AEGIS-ACTION-INTEGRITY | P1 | Task #26 | Capability registry / honest refusal / receipts |
| P1.4 | INC-LEARN-CONTAM frozen stores | P1 | `project_inc_learn_contam` | Anonymization gate before lift |
| P1.5 | Aegis F-stage DISABLED | P1 | Grounding-State Doctrine | Unblock requires grounding + provenance + traversal integrity trust |
| P1.6 | Cross-tenant retrieval exclusivity seam not built | P1 | Aegis Authority Doctrine Amendment | Build seam |
| P1.7 | `generate-learning-context` env-flag gated off | P1 | Impact Assessment 2026-05-30 | Decision required: enable flag + fix class-wide |
| P1.8 | INC-XTEN Track B | P1 | Task #17 | Provenance contract closure |
| P1.9 | INC-XTEN sibling sweep | P1 | Task #19 | Open-RLS + ownerless artifact pass |
| P1.10 | Missing pg_cron jobs (live drift) | P1 | Cron Schedule Alignment | Reconcile registry vs live |
| P1.11 | Trent Reznor report regeneration validation | P1 | Task #51 | Regenerate with claim taxonomy + operator validation |
| P1.12 | Frontend tenant-scoping unverified | P1 | `project_ai_messages_rls_isolation` | Per-surface frontend audit |
| P2.1–P2.14 | (per §9 P2 table) | P2 | Various | Per item |
| P3.1–P3.10 | (per §9 P3 table) | P3 | Various | Per item |

---

## §C — Top 10 Priorities (strict customer/deployment/mission impact ranking)

| Rank | Priority | Customer impact | Deployment risk | Mission impact |
|---|---|---|---|---|
| **1** | **INC-CTX-CONTAM phrase surface (BCH Gender Clinic)** | HIGH — phrase can appear in CRT tenant view | HIGH — customer trust on BC Place / FIFA delivery | HIGH — undermines Grounding-State Doctrine |
| **2** | **INC-LEARN-CONTAM-LEAK in report generators** | HIGH — cross-tenant content in customer reports | HIGH — every customer-facing report at risk | HIGH — undermines tenant isolation in flagship output surface |
| **3** | **Ownerless `executive_intelligence` reports (INC-XTEN-class)** | HIGH — ownerless content in customer-facing reports | HIGH — Provenance Doctrine violation | HIGH — class-level invariant breach |
| **4** | **INC-AEGIS-TRUST P0 + 4 Vince root causes** | HIGH — Aegis answers customer questions | HIGH — perceived trustworthiness | HIGH — Aegis is the flagship surface |
| **5** | **INC-CRT-DOCUMENT-SCOPE** | HIGH — customer documents not retrievable | HIGH — CRT-specific blocker | MEDIUM |
| **6** | **C.4 adoption observation + §11 inventory re-run** | MEDIUM — gates Decision Layer detector work | MEDIUM — timing-dependent | HIGH — gate for R1.1+ entire detector path |
| **7** | **Aegis Unified Retrieval & Intelligence Graph (top arch priority)** | MEDIUM — foundation for tenant retrieval | HIGH — needed before R1.1 detector path | HIGH — TOP architecture priority |
| **8** | **Path A learning loop (FLR)** | MEDIUM — per-tenant gate adaptation off | LOW (Path B partially compensates) | MEDIUM — future-trajectory risk |
| **9** | **Class B Provenance gap on 18 LLM-derived stores** | MEDIUM — analysis content leakage risk | MEDIUM — class-level | MEDIUM |
| **10** | **Cross-tenant retrieval exclusivity seam** | MEDIUM — Aegis Authority Doctrine partial | MEDIUM — gates safe cross-tenant queries | HIGH |

**Notable items NOT in Top 10 (deliberately):**

- Workstream A/B/C ADRs (P2)
- Workstream D UI flag flip (P2)
- Report Generator Standardization (P2 backlog-only)
- C.4 next-review-date editor (already shipped)
- Detection health (already healthy)
- CI hygiene (P3)

---

## §D — Readiness Scores

Each score on 0–10 scale. Evidence required for every score.

### Fortress overall — **5.5 / 10**

| Evidence | Direction |
|---|---|
| Detection healthy (146 signals/7d across 11 categories) | + |
| Major class doctrines ratified (Provenance, Aegis Authority, Grounding-State, Decision Layer) | + |
| Multiple concrete remediations shipped (C.0-C.4, ai_assistant_messages, signal_agent_analyses tenant scoping, agent_tradecraft Class A) | + |
| 5 P0 items open (INC-CTX-CONTAM, INC-LEARN-CONTAM-LEAK, ownerless executive_intelligence, INC-AEGIS-TRUST, INC-CRT-DOCUMENT-SCOPE) | − |
| Aegis F-stage DISABLED until grounding trust | − |
| Path A learning broken; Path B partial | − |
| Cross-tenant retrieval seam not built | − |
| 18 LLM-derived stores with Provenance gaps | − |

**Verdict:** Functional production system for detection + reporting at baseline calibration, with named P0 items blocking high-trust customer-facing claims.

### CRT deployment — **6 / 10**

| Evidence | Direction |
|---|---|
| Customer tenant active; 31 signals/7d; 3 investigations | + |
| Signal ingestion + display tenant-scoped | + |
| Investigation workflow live (incl. C.4) | + |
| MFA + client authorization gates active | + |
| INC-CTX-CONTAM phrase surface (P0.1) | − |
| INC-LEARN-CONTAM-LEAK (P0.3) | − |
| INC-CRT-DOCUMENT-SCOPE (P0.5) | − |
| Bimodal engagement (shell investigations) | − |
| Path A learning empty for CRT | − |

**Verdict:** Capabilities present and live; named P0 items must close before high-trust customer escalation.

### BC Place deployment — **5 / 10**

| Evidence | Direction |
|---|---|
| Customer client active in CRT tenant | + |
| 2 investigations exist + monitoring entities | + |
| BC Place / FIFA staging↔prod parity audit completed | + |
| 0% synopsis populated on existing investigations (10+ days) | − |
| INC-CTX-CONTAM phrase surface specifically referenced BC Place / BCH | − |
| Path A learning empty | − |
| Workstream D claim-frame UI dark | − |
| Aegis F-stage disabled (action execution unavailable) | − |

**Verdict:** Demo-ready at baseline; live-customer-trust delivery requires P0.1 + P0.3 closure + meaningful engagement test.

### Tenant isolation — **6.5 / 10**

| Evidence | Direction |
|---|---|
| Provenance Doctrine ratified + CHECK backstops on multiple stores | + |
| `ai_assistant_messages` open-SELECT closed | + |
| C.0 + C.1 + C.2 canonical workspace tenancy deployed prod | + |
| `signal_agent_analyses` retrieval tenant-scoped 2026-05-30 | + |
| `get_recent_signals` cross-tenant + fixture leak closed | + |
| `agent_tradecraft` Class A migration | + |
| INC-CTX-CONTAM phrase still surfaceable via unscoped RPC | − |
| 18 LLM-derived stores Class B gap | − |
| `learning_profiles` 12/13 readers unscoped (latent leak surface) | − |
| INC-XTEN Track B + sibling sweep open | − |
| Ownerless `executive_intelligence` rows | − |
| Cross-tenant retrieval seam not built | − |
| Aegis perception leaks (INC-AEGIS-TRUST P0) | − |
| INC-CRT-DOCUMENT-SCOPE | − |

**Verdict:** Substantially stronger than 30 days ago; multiple named P0/P1 items still open. Not "fully proven."

### Executive briefing capability — **6 / 10**

| Evidence | Direction |
|---|---|
| Daily briefing cron live | + |
| `signal_agent_analyses` retrieval tenant-scoped 2026-05-30 | + |
| Workstream D claim-frame in place (dark) | + |
| Trent Reznor methodology-injection cured | + |
| INC-LEARN-CONTAM-LEAK open (prompt injection from frozen stores) | − |
| Ownerless executive_intelligence rows | − |
| Workstream D UI dark | − |
| Trent Reznor regeneration validation pending | − |
| Path A learning not feeding patterns | − |
| Report Generator Standardization not initiated | − |
| Class B Provenance gap on `agent_beliefs` content | − |

**Verdict:** Briefings ship; trust attributes incomplete.

### Detection capability — **7 / 10**

| Evidence | Direction |
|---|---|
| 146 signals/7d across 11 categories (active detection) | + |
| 11 monitor functions live | + |
| Wildfire monitoring with tiered classifier | + |
| Per-entity name queries in news monitor | + |
| Daily watchdog with behavioral health phase | + |
| `monitor-instagram-2h` structurally dead (Meta Graph off) | − |
| `monitor-threat-intel` + `monitor-community-outreach` intentionally off | − |
| Path A learning empty — gate runs on baseline calibration | − |
| Signal collapse 2026-05-25 (5-domain allowlist) | − |
| Social monitor dry-up | − |
| 3 missing pg_cron jobs (live drift) | − |

**Verdict:** Detection works at baseline. Adaptive capability offline. Some monitors structurally inactive (intentional or not).

### Learning capability — **3.5 / 10**

| Evidence | Direction |
|---|---|
| Path B (agent prompt evolution) functioning — 83 rows/30d | + |
| `agent_tradecraft` Class A migration prod-applied — 15,418 rows | + |
| Feedback capture intact (`feedback_events` 267/30d) | + |
| Path A statistical learning broken — `learning_profiles` 0 rows lifetime | − |
| All 21 writer sites omit `tenant_id` | − |
| `generate-learning-context` flag-gated off | − |
| `signal-relevance-scorer` runs on hardcoded defaults | − |
| AI gate sees no learned pattern context | − |
| 12/13 readers unfiltered by tenant | − |
| Multiple dormant learning functions (`learn-from-investigations`, `visibility-gap-scanner`) | − |
| INC-LEARN-CONTAM containment still active | − |

**Verdict:** Path B keeps the loop alive partially. Path A is broken class-wide. Learning capability is below baseline.

---

## §E — Standing posture

**Mission state recorded for context survival:**

- C.4 capability complete (PRs #75 #76 merged, prod deployed 2026-05-30)
- C.4 adoption window active (4 weeks; closes ~2026-06-27)
- Detection confirmed healthy via Detection Health Assessment 2026-05-30
- Path A diagnosed + scoped + Phase 0 audited + impact-assessed 2026-05-30
- Path A authorization package committed; only §16.16 GO remains
- R1.1 + R1.2-R1.7 + R2-R6 remain locked behind §11 inventory re-run gate
- INC-LEARN-CONTAM containment active
- INC-CTX-CONTAM containment active (not closed)
- All P0 items open per §9

## §F — What this document is NOT

- Not a proposal of new features.
- Not an implementation plan.
- Not a remediation roadmap.
- Not authorization for any item to begin.
- Not a recommendation of sequencing — only ranked priority for operator review.

## §G — Held (out of scope)

- No code, branch, migration, deploy.
- No watchdog modification.
- No monitor / detector modification.
- No Path A repair authorization.
- No Decision Layer detector authorization.
- No Report Generator Standardization initiation.
- No documentation or UI changes.
- No C.4 adoption analysis (window still active).
- No Workstream D flag flip.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
