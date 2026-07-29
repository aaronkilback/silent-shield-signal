-- WO-LEARNING-LOOP Step 1: record_platform_finding RPC (atomic insert-or-increment, stable
-- digit-normalized fingerprint) + one-time historical collapse 261->49 (applied prod 2026-07-29
-- via MCP; see migration platform_findings_fingerprint_dedup). RPC body:
create or replace function public.record_platform_finding(
  p_category text, p_severity text, p_title text, p_analysis text,
  p_plain_english text, p_action text, p_affected_agent text, p_affected_job text
) returns void language plpgsql as $$
declare v_fp text;
begin
  v_fp := encode(digest(
    coalesce(p_category,'unknown') || '|' ||
    regexp_replace(left(coalesce(p_title,''),100), '[0-9]+', '#', 'g') || '|' ||
    coalesce(p_affected_job,''), 'sha256'), 'hex');
  insert into public.platform_findings
    (fingerprint, category, severity, title, analysis, plain_english, action,
     affected_agent, affected_job, metadata, first_seen_at, last_seen_at, occurrence_count, resolved_at)
  values
    (v_fp, coalesce(p_category,'unknown'), coalesce(p_severity,'info'), p_title, p_analysis,
     p_plain_english, p_action, p_affected_agent, p_affected_job,
     jsonb_build_object('source','system-watchdog'), now(), now(), 1, null)
  on conflict (fingerprint) do update set
    last_seen_at = now(),
    occurrence_count = public.platform_findings.occurrence_count + 1,
    severity = excluded.severity, title = excluded.title, analysis = excluded.analysis,
    plain_english = excluded.plain_english, action = excluded.action,
    affected_agent = excluded.affected_agent, affected_job = excluded.affected_job,
    resolved_at = null;
end; $$;
