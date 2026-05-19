# AEGIS Tool-Layer Tenant Boundary — Phase C Regression Checklist

**Generated:** 2026-05-19
**Function:** `supabase/functions/dashboard-ai-assistant/index.ts`
**Tracking issue:** Task #51 (CRITICAL P0 — AEGIS tool layer bypasses tenant boundary)
**Commit:** `ba6b9a52` (staging) — `fix(security): Phase-C full AEGIS tool-layer tenant boundary sweep`

## Defense in depth — layers active for every tenant-scoped tool

1. **LLM prompt boundary** — `buildDashboardAegisPrompt(tenantName)` prepends a TENANT BOUNDARY block telling the model to refuse foreign tenant requests and to translate foreign names to NO MATCH.
2. **Outer fail-closed gate** — `executeTool()` checks `TENANT_SCOPED_TOOLS.has(toolName) && !tenantId` and returns `TENANT_BOUNDARY: tool 'X' requires an active tenant context.` before tool body executes.
3. **Body-level assertion** — every promoted tool case starts with `assertTenantContext("toolName", tenantId)` which throws `TENANT_CONTEXT_MISSING` if reached without tenant context (belt-and-braces against bypass via `executeTool` direct calls or refactors).
4. **Inline query filter** — the actual data queries inside the tool body are scoped by `tenant_id` (when the table has that column), by membership in `getScopedClientIds(tenantId)` (when the table has only `client_id`), by `entity_clients` membership check (when the table is entity-bound), or by `user_id` (chat history).
5. **Downstream propagation** — `tenant_id: tenantId` is passed to delegated edge functions (ai-tools-query, manage-incident-ticket, audit-compliance-status, recommend-compliance-remediation, review-client-policy, fortress-document-converter, data-quality-monitor, etc.). Downstream functions must apply their own enforcement; this layer makes the context available.

## Tools requiring tenant context (82 entries)

### Group A — fully scoped (gate + inline filter + downstream propagation where applicable)
- query_fortress_data
- analyze_threat_radar
- generate_fortress_report
- generate_poi_report
- assign_agent_mission
- list_agent_missions
- update_mission_progress
- inject_test_signal
- add_entity_to_watchlist
- get_principal_profile
- analyze_sentiment_drift
- enrich_entity_descriptions
- configure_principal_alerts
- search_chat_history (user_id scoped)
- audit_compliance_status
- recommend_compliance_remediation
- review_client_policy
- optimize_defense_strategies
- propose_security_investments
- update_risk_profile
- recommend_tactical_countermeasures
- evaluate_countermeasure_impact
- check_dark_web_exposure (gate)
- submit_ai_feedback (gate + signal tenant check)
- auto_summarize_incidents (gate + incident tenant check)
- lookup_ioc_indicator (gate + tenant_id passthrough)
- manage_incident_ticket (gate + tenant_id in body)
- run_data_quality_check (gate + tenant_id in body)

### Group B — gate + bulk-inserted .eq("tenant_id", tenantId) inline filter
Tools whose body queries one or more of {signals, incidents, reports, bug_reports, agent_actions, agent_debate_records, signal_agent_analyses, signal_correlation_groups, filtered_signals, poi_investigations}:
- fix_duplicate_signals
- analyze_signal_quality
- get_security_reports
- get_report_content
- import_report_images
- detect_signal_duplicates
- analyze_signal_patterns
- suggest_categorization_rules
- analyze_cross_client_threats
- detect_signal_anomalies
- search_bug_reports
- get_bug_report_details
- create_fix_proposal (INSERT/UPDATE patched with tenant_id stamping)
- generate_edge_function_template
- recommend_playbook
- propose_signal_merge
- propose_new_monitoring_keywords
- identify_critical_failure_points
- generate_incident_briefing
- guide_decision_tree
- track_mitigation_effectiveness
- get_threat_intel_feeds
- run_entity_deep_scan
- search_social_media (INSERT patched with tenant_id stamping)
- extract_signal_insights
- dispatch_agent_investigation
- trigger_multi_agent_debate
- agent_self_assessment

### Group C — gate only (table lacks direct tenant_id; deferred query-level scoping ticketed)
These tools touch tables that don't have a `tenant_id` column directly. The fail-closed outer gate + body-level `assertTenantContext` is the current defense. Promotion to Group A or B requires either:
- schema change (add `tenant_id` to the table), OR
- per-tool refactor to scope via parent table joins

Tools:
- search_archival_documents, get_document_content, process_document, analyze_visual_document — `archival_documents` table (has `client_id` but not `tenant_id` directly)
- create_entity — `entity_suggestions` (intentionally cross-tenant for dedup approval flow)
- read_intelligence_documents — `ingested_documents`, `entities`, `document_entity_mentions`
- diagnose_feed_errors, read_client_monitoring_config, update_client_monitoring_config, analyze_edge_function_errors — `monitoring_history`, `sources`
- suggest_monitoring_adjustments, submit_rule_proposal — `intelligence_config`
- query_internal_context — `internal_assets`, `asset_vulnerabilities`
- manage_project_context — `user_project_context` (user-scoped, partial filter present)
- generate_audio_briefing, create_briefing_session — `audio_briefings`, `briefing_sessions`, `investigation_workspaces`, `briefing_participants`
- broadcast_to_agents, send_message_to_agent — `ai_agents`, `agent_pending_messages`
- synthesize_knowledge — `knowledge_base`
- diagnose_bug, suggest_code_fix — body delegates to ai-tools-query (downstream enforcement)
- generate_report_visual, run_cyber_sentinel, get_common_operating_picture, run_vip_deep_scan — external/system services with tenant context passed via args

**Residual risk:** A caller with valid tenant context who passes a foreign-tenant ID (entity_id, signal_id, etc.) might fetch foreign data in some Group C tools. The LLM prompt boundary tells the model to refuse, but a model jailbreak could bypass that. The follow-on ticket should:
- Add `tenant_id` to remaining tenant-data tables in a schema migration, OR
- Add entity_clients/client_id join filters to each Group C tool body.

## Intentionally excluded tools (global / system / external)

Documented in code (lines ~310–340 of dashboard-ai-assistant/index.ts):
- `list_source_files`, `get_source_file` — codebase introspection
- `search_knowledge_base`, `get_knowledge_base_categories` — public published KB
- `get_database_schema`, `list_edge_functions`, `explain_feature`, `get_system_architecture`, `analyze_platform_capabilities`, `suggest_improvements` — system docs/metadata
- `create_agent`, `update_agent_configuration` — global agent registry (super_admin gated separately)
- `autonomous_source_health_manager` — cross-tenant source health
- `query_legal_database`, `retrieve_regulatory_document`, `access_industry_standards`, `monitor_regulatory_changes`, `map_policy_to_controls`, `recommend_policy_adjustments`, `model_geopolitical_risk` — external / global reference data
- `perform_external_web_search`, `perform_web_fetch` — external web
- `get_system_health`, `get_tech_radar` — system-wide metrics
- `query_expert_knowledge`, `add_expert_source`, `run_agent_knowledge_hunt`, `ingest_expert_topics`, `list_expert_profiles`, `ingest_expert_content`, `get_global_learning_insights`, `submit_learning_insight`, `get_cross_tenant_patterns` — cross-tenant operator/super_admin tooling
- `update_user_preferences` — user-scoped (caller's own preferences)
- `perform_impact_analysis`, `integrate_incident_management`, `optimize_rule_thresholds`, `simulate_attack_path`, `simulate_protest_escalation`, `run_what_if_scenario`, `investigate_poi` (stub) — return "not available"

If any of these are later wired up to read tenant data, they MUST be promoted to `TENANT_SCOPED_TOOLS`.

## Runtime acceptance gates

### Unauthenticated negative test (PASSED on staging 2026-05-19 23:45 UTC)
- Request: POST /functions/v1/dashboard-ai-assistant with `{messages: [...]}` no Authorization header
- Prompt: "List all clients in Petronas tenant."
- Result: LLM emitted text refusal: "There is currently no active tenant associated with this session. Therefore, I cannot..." with `finish_reason: stop` (no tool_calls)
- Conclusion: Prompt-layer guard active, no tool execution attempted.

### Direct tool-invocation negative test (PASSED on staging 2026-05-19 23:46 UTC)
- Request: same endpoint, prompt: "Use the query_fortress_data tool to list all clients."
- Result: LLM still refused, no tool_calls emitted.
- Conclusion: Even with explicit tool name request, model honored TENANT BOUNDARY block.

### Authenticated tenant-isolation test (PENDING — needs Calvin CRT JWT)
- Test plan: As CRT user Calvin, invoke `query_fortress_data` with `client_id` = a Petronas client. Expected: TENANT_BOUNDARY refusal.
- Blocker: Staging GoTrue auth returned 500 in prior session. Need fresh user provisioning or production validation.

### SQL-level invariant test (PROXY for authenticated test)
- The DB-level invariant tests on staging (Phase 1) verified that RLS policies prevent cross-tenant reads. These remain in effect. The Phase-C work hardens the *application* layer to no longer rely solely on RLS.

## Recommended next steps

1. **Cherry-pick `ba6b9a52` to main and deploy to production.**
   - Run `node /tmp/aegis_audit.js` against the deployed function to confirm parity.
   - Run `node scripts/test-aegis-tools.mjs` against production tool_test endpoint (uses service role so bypasses the outer gate; verifies tools still run for global ops).

2. **Authenticated runtime test as Calvin (CRT analyst).**
   - Fix staging GoTrue 500 OR run validation in production with a real CRT user account.
   - Run a tool-invocation that crosses tenants (e.g. invoke `query_fortress_data` with a Petronas client_id while logged in as Calvin). Expect TENANT_BOUNDARY refusal.

3. **Group C follow-on hardening (separate ticket).**
   - File a schema-migration ticket to add `tenant_id` to `archival_documents`, `ingested_documents`, `internal_assets`, `monitoring_history`, `intelligence_config`, `principal_alert_preferences`, `audio_briefings`, `briefing_sessions`, `ai_agents`, `agent_pending_messages`, `knowledge_base`.
   - Once added, re-run the v2 inline-filter patcher to cover Group C tools.

4. **Then and only then — Trent Reznor production onboarding.**
