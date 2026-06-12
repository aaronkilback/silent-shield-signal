# No-Tenant Clearance Sweep — prepared plan (2026-06-12)

**Status:** PREPARED, NOT EXECUTED. The audited 25-table set (Batches 1–3 + internal_assets) is closed.
This sweep covers tables a no-tenant authenticated JWT can still read/write via broad
`authenticated`/PUBLIC policies but which have **no `client_id`/`tenant_id` column** (so the original
audit missed them). **Account creation stays blocked until this is closed.** `service_role` policies excluded.

## Why this matters (live exposure, not just latent)
A no-tenant traveller login (authenticated, no tenant membership) can today read these LIVE tables:

| Table | Rows | Concern |
|---|---|---|
| `monitoring_history` | **64,925** | per-source/client monitoring logs |
| `report_evidence_sources` | **4,847** | tenant report evidence/citations |
| `expert_knowledge` | **4,659** | shared knowledge store — needs L2-vs-tenant classification (see decontam history) |
| `media_assets` | 141 | possibly tenant evidence/images |
| `expert_profiles` | 89 | |
| `threat_trajectories` | 8 | threat trajectories (parent of the already-scoped `trajectory_positions`) |
| `asset_vulnerabilities` | 5 | vulnerability records |
| `environment_config` | 1 | platform config (verify not secret-bearing) |

Plus **broad-WRITE** (any authenticated can INSERT/UPDATE/DELETE — integrity/abuse risk, not just read):
`circuit_breaker_state`, `cron_heartbeat`, `cron_job_registry`, `dead_letter_queue`, `debate_predictions`,
`incident_outcomes`, `signal_anomaly_scores`, `frontend_errors`, `audit_stage_analyses`, `media_assets`,
`speculative_analyses`, `episode_arc_appearances`, `episode_arcs`, `knowledge_connections`, `learnings`,
`listener_feedback`, `client_authorizations`, `petronas_assets`, `codebase_snapshot`.

## Candidate triage (PRELIMINARY — each needs schema+usage+data classification like Batches 1–3)

### Category A — likely tenant/client operational → scope or fail closed (HIGH)
`monitoring_history`, `report_evidence_sources`, `media_assets`, `threat_trajectories`, `asset_vulnerabilities`,
`petronas_assets` (client-specific by name; read+write broad), `client_authorizations` (authz data; read+write broad),
`signal_clusters`, `signal_contradictions`, `signal_score_explanations`, `signal_anomaly_scores`,
`speculative_analyses`, `incident_outcomes`, `incident_classification_rationale`, `task_force_agents`,
`task_force_contributions`, `wraith_signal_threat_scores`, `wraith_vulnerability_findings`, `briefing_claims`,
`claim_sources`, `geospatial_maps`, `investigation_autopilot_sessions`, `investigation_autopilot_tasks`,
`investigation_similarity_cache`, `investigation_compliance`, `knowledge_freshness_audits`, `agent_assessments`,
`agent_accuracy_metrics`, `agent_calibration_scores`, `agent_specialty_embeddings`, `agent_learning_sessions`.
→ These lack a scope column. For each: find the derivation path (FK to signals/incidents/clients/entities) and scope via that, OR fail closed (super_admin/admin + service_role) where unowned/derived-only. Several are agent-learning tables — check the AI-data-plane RLS doctrine ([[project_phase_1_6_ai_dataplane_rls]]) for the intentionally-global list before deciding.

### Category B — candidate global/reference (keep, but replace `true` with explicit labelled-global; verify non-sensitive)
`academy_modules`, `academy_courses`, `academy_credentials`, `world_geographies`, `world_geography_layers`,
`world_knowledge_sources`, `macro_indicators`, `knowledge_base_categories`, `knowledge_base_articles`,
`doctrine_library`, `rules_of_engagement`, `simulation_scenarios`, `sequence_patterns`, `source_credibility_scores`,
`prompt_versions`, `executive_tone_rules`, `onboarding_required_versions`, `wildfire_portal_usage`,
`wildfire_station_ratings`, `episode_embeddings`, `episode_judgments`, `episode_arcs`, `episode_arc_appearances`,
`listener_feedback`, `learnings`, `ai_agents`, `expert_knowledge`*, `expert_profiles`*, `global_chunks`*, `global_docs`*.
→ *`expert_knowledge`/`expert_profiles`/`global_chunks`/`global_docs` are RAG/knowledge stores that MAY contain tenant-derived content → require explicit L2-vs-tenant classification (no assuming global). The rest look like platform reference but confirm non-sensitive before labelling global.

### Category C — infra/ops → restrict to service_role (+admin read where needed); remove authenticated, esp. WRITE
`cron_heartbeat`, `cron_job_registry`, `circuit_breaker_state`, `dead_letter_queue`, `codebase_snapshot`,
`codebase_snapshots`, `frontend_errors`, `rate_limit_tracking`, `autonomous_actions_log`, `qa_test_results`,
`environment_config`, `debate_predictions`, `media_assets`(write), `audit_stage_analyses`(write).
→ No normal user needs these; several allow authenticated WRITE to control-plane tables (cron, circuit breakers, DLQ) = integrity risk. Lock to service_role; admin-read only where a dashboard needs it.

## Method (same as Batches 1–3)
Per table: classify (schema + grep usage + data spread) → decide (SET-C / SET-T / derive-via-FK / explicit-labelled-global / fail-closed / service-role-only) → in-transaction dry-run with synthetic two-tenant + NULL rows → apply → real two-tenant + no-tenant verification → repo migration mirror. Rules unchanged: no broad `true`/authenticated left; don't assume global from emptiness; don't assume L2 without an approval/anonymization mechanism; fail closed when unclear; preserve service_role + admin.

## Suggested batches
- **Sweep-1 (HIGH live + integrity):** petronas_assets, client_authorizations, monitoring_history, report_evidence_sources, media_assets, threat_trajectories, asset_vulnerabilities, environment_config + the broad-WRITE control-plane set (cron_*, circuit_breaker_state, dead_letter_queue, frontend_errors).
- **Sweep-2 (operational, mostly 0 rows now):** the rest of Category A (signal_*, incident_*, task_force_*, wraith_*, investigation_autopilot/*, agent_* learning).
- **Sweep-3 (reference/L2 classification):** Category B, with expert_knowledge / global_chunks / global_docs getting explicit L2-vs-tenant determination first.

## Account-creation gate
Traveller/family accounts remain **BLOCKED** until at least Sweep-1 (live leaks + integrity) is closed and verified, since a no-tenant login can currently read `expert_knowledge` (4,659), `report_evidence_sources` (4,847), `monitoring_history` (64,925), etc., and write to control-plane tables.
