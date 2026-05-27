# ADR — Aegis Authority Modes (explicit, enforceable)

**Status:** DESIGN (no code). Authority projection of the 3-layer memory model (`aegis-three-layer-memory.md`). Closes the INC-AEGIS-TRUST / INC-CRT gap where super_admin's elevated reach silently mixed into tenant answers.
**Principle:** Aegis runs both tenant intelligence and platform operations, but **authority is explicit, server-resolved, and enforced — never implied.** A session is always in exactly one declared mode with a known effective tenant and authority level.

## Identity architecture decision — SPLIT (Aegis vs Aegis Ops)
**Decision: separate operational identities, not one persona spanning all authority (Option 2).** The tenant boundary is the security boundary that matters; the identity boundary must coincide with it.

| Dimension | Option 1 — single Aegis, explicit modes | Option 2 — split identities (**chosen**) |
|---|---|---|
| **Trust clarity** | Medium — same name/persona; mode is metadata a tenant may not internalise ("did *Aegis* just tell me a platform fact?") | **High** — a tenant only ever talks to **Aegis** (tenant intelligence officer); **Aegis Ops** is an internal surface they never see. The name *is* the boundary. |
| **Operator cognition** | Low-Med — operator must track "am I in B or C"; classic root/prod-vs-staging ambiguity | **High** — platform work = go to Aegis Ops; tenant/impersonation = Aegis. Distinct surfaces, distinct mental models. |
| **Privilege separation** | Medium — one identity + mode flag; a mode-resolution bug = privilege bleed (single blast radius) | **High** — two registries / entry points; platform tools are **not wired** into the tenant surface, so a bug cannot expose them there. Defense-in-depth. |
| **Auditability** | Medium — all actions under one "Aegis" actor; must filter on mode | **High** — actor identity itself encodes authority class ("Aegis Ops did X" = unambiguously a platform op). |
| **Accidental-misuse risk** | **Higher** — soft boundary in the user's mind; operator runs a cross-tenant op while mentally "helping the tenant" | **Lower** — wrong surface entirely; the tenant surface has no cross-tenant op to run. |
| **Implementation complexity** | **Lower** — one function/persona/dispatcher + mode gate | Higher — two personas/entry points + partitioned registries over a shared core. |

Option 1 is the more elegant abstraction; **Option 2 is the safer operational model** — the directive's stated tie-breaker. The cost (more surface) buys a *physical* partition of the most dangerous boundary.

### Further decision — ELIMINATE impersonation (MODE C). Operator never "becomes" a tenant.
Pressure-testing the last boundary: super-admin impersonation is removed entirely. **Aegis = strictly real tenant users, tenant-bounded. Aegis Ops = always operator.** When an operator needs CRT context, Aegis Ops queries CRT **as operator, by explicit target** — it does not pretend to become CRT.

| Dimension | Impersonation (operator *becomes* tenant) | Explicit operator-target (**chosen**) |
|---|---|---|
| **Trust clarity** | Low — actions look tenant-originated; "who is acting?" is ambiguous | **High** — operator is always operator; "operator viewing/acting on CRT" is explicit |
| **Auditability** | Poor — primary actor recorded as the tenant scope; the human is in metadata only; operator actions *masquerade as tenant actions* (a provenance lie) | **Excellent** — actor = operator (a person), target = tenant parameter; every cross-tenant touch attributes to a human |
| **Privilege separation** | Weak — operator transiently holds tenant authority *as* the tenant; the enter/exit transition is the risk surface | **Strong** — operator never holds tenant-identity authority; operator authority is its own bounded class with explicit targets |
| **Accidental-leakage risk** | Higher — false "I'm safely in tenant mode" frame; impersonation paths override JWT/claims/tenant-context (RLS-bypass-prone) — this is the **INC-CRT-VISIBILITY scoping-bug class** | **Lower** — the operator surface is always known to be cross-tenant-capable (no false safety); no claims-override machinery exists |
| **Implementation simplicity** | Complex — JWT/claims/tenant-context override, enter/exit transitions, special-case scoping (the shipped notification fix `isSuperAdmin && !isAllTenantsView ? currentTenant : null`) | **Simple** — no impersonation machinery; two non-overlapping auth models |

**Decisive:** the product already does *operator-selects-a-tenant-target* (`ClientSelectionProvider`, and the notification fix scoped by `currentTenant` — operator viewing a chosen tenant, not "becoming" it). MODE C as identity-assumption was the wrong abstraction for what exists, and it is precisely the source of the INC-CRT scoping-bug class. The explicit-target model **formalises reality and deletes the only ambiguous authority transition in the system** — the stated goal. "Acting on behalf of a customer" becomes an audited *operator action on tenant X*, which is strictly better for accountability than an action that looks like the tenant did it.

**Boundary placement (final — two identities, ZERO authority transitions):**
- **Aegis** (tenant identity, customer-facing) = **MODE A only**. Effective tenant = the user's own tenant, immutable, from their `tenant_users` membership. **No operator is ever present on this surface.**
- **Aegis Ops** (operator identity, internal-only) = **MODE B** (platform-wide) **+ explicit cross-tenant target reads/actions**. The operator is *always* the operator; a tenant is a `target_tenant` parameter on a query/action, never an assumed identity. Output that targets a tenant is framed and audited as *operator → tenant X*.

There is no in-session identity switch anywhere: a session is either a tenant user (Aegis) or the operator (Aegis Ops), fixed at authentication. Effective tenant in Aegis is immutable; "target tenant" in Aegis Ops is a per-action parameter, not a mode.

⚠️ **The split only delivers its safety if the partition is physical** — separate tool registries and entry points, platform tools genuinely absent from the Aegis surface, and **no impersonation/claims-override code path anywhere**. "Two personas over one wired-up tool set" loses the entire benefit.

## Tenant-Aegis is powerful, not narrow (scope ≠ capability reduction)
The split does NOT make customer-facing Aegis a passive Q&A bot. **Aegis remains a broad, operational tenant intelligence officer** — within the tenant boundary it must: answer questions, summarise tenant intelligence, give links + source references, upload & analyse attachments, view/summarise links where tool-supported, help with tasks, **manage entities, manage sources, toggle monitoring, generate reports, support investigations.** The constraint is authority + scope + tool-truth + completion-verification, **not breadth.** Every capability runs the same contract:
1. **tenant-scoped retrieval FIRST** → 2. **approved-clean global learning SECOND** → 3. **no cross-tenant disclosure** → 4. **no implied tools** (registry-gated) → 5. **no fake success** (honest refusal) → 6. **post-action receipt** (measured post-condition).

Design target: **powerful but bounded** — Aegis should feel useful and operational inside the tenant, while the boundary is a hard wall, not a leash.

## The two identities (no third mode)
| | **Aegis — Tenant Intelligence Officer** (MODE A) | **Aegis Ops — Platform Operations Officer** (MODE B) |
|---|---|---|
| **Surface** | customer-facing | operator-only, internal |
| **Scope** | the user's own tenant (immutable) | platform-wide + explicit `target_tenant` per query/action |
| **Memory** | L1 (own tenant) + approved-clean L2 | platform + operator (L3) + cross-tenant aggregates + L2-analysis |
| **Authority** | tenant CRUD/actions only | admin/platform ops + operator reads/actions *on* a named tenant |
| **Identity** | actor = tenant user; never an operator | actor = operator/super_admin; **always** — never assumes a tenant identity |
| **Capabilities** | entities, sources, incidents, reports, investigations, documents, monitoring actions (full breadth — see above) | diagnostics, failed jobs, cross-tenant audits, support, platform repair, monitor tuning, global-learning analysis |

**There is no impersonation mode.** An operator who needs tenant context uses Aegis Ops and names the `target_tenant` explicitly, remaining the operator; the action is audited as *operator → tenant X*, never as the tenant.

## Identity resolution (server-side, spoof-proof, fixed at auth)
Resolved from identity, **never user-claimed** — reusing the sound tenant derivation (`dashboard-ai-assistant:10061`, `userTenantId` from `tenant_users`, spoof-proof):
- Non-super_admin user → **Aegis**, tenant = their own membership tenant. Cannot reach Aegis Ops.
- super_admin on the operator surface → **Aegis Ops**; cross-tenant reads/actions require an explicit `target_tenant` argument and are attributed to the operator.
- Fails closed: an unauthorized request for the operator surface degrades to Aegis (tenant) for the caller's own tenant, never up.
- **No in-session identity switch exists** — the surface is fixed at authentication. Effective tenant in Aegis is immutable; `target_tenant` in Aegis Ops is a per-action parameter, not an identity transition.
- **Transitions are explicit + logged.** A session cannot drift A→B mid-conversation; switching modes is a deliberate, authority-checked, audited action.

## Capability map (partition of the real tool registry)
Every tool is assigned to exactly one partition. (Reconciles the informal comment-block taxonomy at `dashboard-ai-assistant:357-384` into an enforced one.)

**MODE A — TENANT (L1 + approved L2; effective-tenant scoped):**
- *Reads:* `get_recent_signals`, `get_active_incidents`, `search_entities`, `get_entity_details`, `search_signals_by_entity`, `get_signal_incident_status`, `get_security_reports`, `get_report_content`, `search_archival_documents`, `get_document_content`, `search_investigations`, `read_intelligence_documents`, `read_client_monitoring_config`, `query_fortress_data` (tenant types)
- *Actions/CRUD:* `create_entity`, `update_entity`†, bulk/single monitoring toggle†, `inject_test_signal`, `submit_ai_feedback`, `manage_incident_ticket`, `add_entity_to_watchlist`, `generate_fortress_report`, `generate_poi_report`, `process_document`, `run_entity_deep_scan`, `run_vip_deep_scan`, `investigate_poi`, `dispatch_agent_investigation`, `trigger_multi_agent_debate`, `configure_principal_alerts`, `create_source`†
- *L2 enrichment (read-only, approved-clean only):* `expert_profiles`, `knowledge_base_articles`, `source_credibility_scores`, `sequence_patterns`, `threat_trajectories`, `world_knowledge_sources`, `agent_learning_sessions[proactive]` (via `globalLearning()`)

**MODE B — PLATFORM (platform + operator memory; cross-tenant):**
- *Diagnostics:* `diagnose_issues`, `analyze_database_issues`, `analyze_edge_function_errors`, `diagnose_feed_errors`, `diagnose_bug`, `get_system_health`, `get_monitoring_status`, `run_data_quality_check`, `detect_signal_anomalies`, `identify_critical_failure_points`
- *Failed jobs / repair:* `autonomous_source_health_manager`, `fix_duplicate_signals`, `analyze_signal_quality`, `optimize_rule_thresholds`
- *Cross-tenant audit:* `analyze_cross_client_threats`, cross-tenant aggregates, `get_cross_tenant_patterns`‡
- *Support / bug:* `search_bug_reports`, `get_bug_report_details`, `suggest_code_fix`, `create_fix_proposal`
- *Monitor tuning:* `suggest_monitoring_adjustments`, `propose_new_monitoring_keywords`, `create_categorization_rule`
- *Global-learning analysis:* `get_global_learning_insights`‡, `query_expert_knowledge`‡, `synthesize_knowledge`, knowledge ingestion
- *Agent registry / platform meta:* `create_agent`, `update_agent_configuration`, `get_database_schema`, `list_edge_functions`, `get_system_architecture`, `analyze_platform_capabilities`

**SHARED-SAFE (both modes; no tenant disclosure, no platform mutation):**
- *External reference:* `perform_external_web_search`, `perform_web_fetch`, `query_legal_database`, `retrieve_regulatory_document`, `access_industry_standards`, `get_tech_radar`, `explain_feature`, `search_knowledge_base`
- *Caller-scoped:* `get_user_memory`, `remember_this`, `update_user_preferences`, `manage_project_context`

† not yet implemented (INC-AEGIS-ACTION-INTEGRITY AR5 — build tenant-scoped, with receipts). ‡ currently **INC-LEARN-CONTAM read-disabled** until the stores are cleaned.

## Enforcement design — the six requirements
**1. Capability registry — no implied powers.** One declarative source of truth: `{ tool → modes[], authority_level, tenant_scoped, requires_receipt, implemented }`. Generated/validated against the live dispatcher (AR1). A tool absent from the registry, or registered for a different mode, is **not callable**. The registry is the partition (req. 5) and the capability manifest (kills the prose denylist).

**2. Honest refusal.** `executeTool` gate order: (a) tool exists + `implemented`? (b) permitted in current mode? (c) tenant context present if `tenant_scoped`? Any miss → explicit *"I cannot do that — [reason: not a capability / not available in MODE X / requires elevation]"* + nearest lawful alternative. Never simulate success. Generalizes the gold-standard `investigate_poi:9899` refusal and the `CONTAINMENT_DISABLED_TOOLS` gate.

**3. Explicit receipts.** Tools flagged `requires_receipt` must re-read and return the measured post-condition; the response states it verbatim (*"61 CRT entities updated, active_monitoring_enabled=true"*), never *"Done."* (AR3.) Writes stamp provenance with the real actor — a tenant user (Aegis) or the operator + `target_tenant` (Aegis Ops) — never a tenant identity the operator assumed (there is none).

**4. Scope declaration.** Every session carries a **scope header** — `{ identity (Aegis | Aegis Ops), tenant (own | target_tenant), actor, authority_level }` — injected into the system prompt and exposed via a `get_current_scope` tool, so the assistant can always state which surface it is, which tenant is in scope, and who is acting. Composition discipline: Aegis — *"For CRT I can …"*; Aegis Ops — *"As operator, targeting CRT, I can … (this is a platform/cross-tenant action)."*

**5. Tool partitioning.** The registry partitions tools (A / B / shared). The `executeTool` gate rejects any cross-partition call for the current mode — a MODE-A session cannot invoke a MODE-B tool, and vice versa. No silent mixing; a mode boundary is a hard gate, and crossing it is an explicit, logged transition.

**6. Retrieval partitioning.** Via the `tenantRetrieve()` / `globalLearning()` seam (R1): Aegis reads L1 scoped to the user's own tenant + approved-clean L2 only; Aegis Ops may read cross-tenant for audit/diagnostics (always with an explicit `target_tenant`) but its **shared/global outputs must be anonymized** — tenant facts never bleed into a platform-shared artifact (the write-side anonymization gate, INC-LEARN-CONTAM remediation). `buildCOP` is split by surface (tenant COP for Aegis; fleet/operator picture for Aegis Ops). The shipped notification `currentTenant`-scoping fix is the template for operator-targets-a-tenant reads.

## Relationship to existing doctrine & state
- **Identities = authority projection of the layers:** Aegis↔(L1 own-tenant + approved L2); Aegis Ops↔(L3 operator + cross-tenant + L2-analysis, by explicit target).
- Subsumes the implicit-mode defects by deleting the mechanism behind them: INC-AEGIS-TRUST (super_admin reach mixing into tenant answers) and INC-CRT (impersonation scope) both stemmed from one identity spanning tenant + operator authority — removed here; INC-LEARN-CONTAM (retrieval/output partitioning) is enforced by req. 6.
- Enforcement substrate already exists to build on: server-side tenant derivation, `TENANT_SCOPED_TOOLS` gate, `assertTenantContext`, `CONTAINMENT_DISABLED_TOOLS`, the per-request scoped-client cache. The new work is the **explicit mode object + the registry-driven partition gate**, not greenfield.
- **Sequencing:** depends on the same canonical order — R1 retrieval seam + R2 leak fixes must land before MODE B's cross-tenant reads are trustworthy; AR1 registry is the spine of requirements 1/2/5; AR3 receipts satisfy requirement 3. Authority modes are the unifying frame these roll up into. INC-LEARN-CONTAM containment stays in force until its remediation; MODE B global-learning analysis runs on the approved-clean L2 subset only until then.

**No mutations. Design correction. Implementation is separate, gated, sequenced after ratification — and after INC-LEARN-CONTAM remediation for the ‡ capabilities.**
