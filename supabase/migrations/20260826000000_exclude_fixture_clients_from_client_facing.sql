-- WO-FIXTURE-EXCLUSION (2026-08-26). Client-facing surfaces must exclude fixture/benchmark/QA
-- clients the same way monitors already skip them (underscore-name convention, archetypes.ts).
-- Trigger: "QA Batch3 test incident" (client _qa_alert_render, is_test=false) leaked into the daily
-- briefing because the canonical active_incidents view filters is_test but NOT fixture clients.
alter table public.clients add column if not exists is_fixture boolean not null default false;
comment on column public.clients.is_fixture is
  'Fixture/benchmark/QA client (underscore-name convention). Excluded from client-facing surfaces the same way monitors skip them. WO-FIXTURE-EXCLUSION 2026-08-26.';

update public.clients set is_fixture = true where name like '\_%' escape '\' and not is_fixture;

-- Recreate active_incidents with a fixture-client exclusion. NULL client_id (global [PATTERN]
-- incidents) is preserved — only rows whose client is a known fixture are dropped.
create or replace view public.active_incidents as
 SELECT id, signal_id, priority, opened_at, acknowledged_at, contained_at, resolved_at, owner_user_id,
        sla_targets_json, status, timeline_json, created_at, updated_at, client_id, is_read, is_test,
        title, summary, incident_type, severity_level, ai_analysis_log, assigned_agent_ids,
        initial_agent_prompt, investigation_status, task_force_name, deleted_at, tenant_id,
        source_reliability, information_accuracy, closed_at, deletion_reason, provenance_type,
        provenance_id, provenance_summary, created_by_function, outcome_type, outcome_notes,
        outcome_recorded_at, dedup_key, superseded_by, duplicate_count, last_seen_at, is_stale, stale_since
   FROM incidents
  WHERE deleted_at IS NULL AND superseded_by IS NULL AND COALESCE(is_test, false) = false
    AND (status::text <> ALL (ARRAY['resolved'::text, 'closed'::text]))
    AND (client_id IS NULL OR client_id NOT IN (SELECT id FROM public.clients WHERE is_fixture));
