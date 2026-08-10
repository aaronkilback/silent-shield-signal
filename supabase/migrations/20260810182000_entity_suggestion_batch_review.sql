-- WO-ENTITY-EXTRACTION-POLLUTION #5 triage — batch-approval-by-pattern.
-- Makes the (post dedup+auto-reject) ~878-distinct queue reviewable/approvable by
-- group instead of one-by-one. (Applied via MCP; file committed for repo parity.)
-- Both functions anon-revoked per the anon-surface doctrine (agent-sentinel Probe 2f).

create or replace function public.entity_suggestion_batches()
returns table(suggested_type text, client_id uuid, source_type text, n bigint, sample_names text[])
language sql stable security definer set search_path = public as $$
  select suggested_type, client_id, source_type, count(*) as n,
    (array_agg(suggested_name order by confidence desc nulls last))[1:10] as sample_names
  from public.entity_suggestions
  where status = 'pending'
  group by suggested_type, client_id, source_type
  order by count(*) desc
$$;

create or replace function public.approve_entity_suggestion_batch(
  p_type text, p_client_id uuid, p_source_type text, p_reviewer uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare _n int := 0; _s record; _eid uuid;
begin
  if p_reviewer is null then raise exception 'reviewer required (audit)'; end if;
  for _s in
    select * from public.entity_suggestions
    where status = 'pending' and suggested_type = p_type
      and client_id is not distinct from p_client_id
      and source_type = p_source_type
  loop
    select id into _eid from public.entities
      where lower(name) = lower(_s.suggested_name) and type = _s.suggested_type limit 1;
    if _eid is null then
      insert into public.entities(name, type, aliases, attributes, is_active, description,
        client_id, tenant_id, visibility_class, entity_status)
      values(_s.suggested_name, _s.suggested_type, coalesce(_s.suggested_aliases,'{}'),
        coalesce(_s.suggested_attributes,'{}'::jsonb), true,
        'Batch-approved from '||_s.source_type||' suggestion',
        _s.client_id, _s.tenant_id, 'reviewed', 'confirmed')
      returning id into _eid;
    end if;
    update public.entity_suggestions
      set status='approved', matched_entity_id=_eid, reviewed_by=p_reviewer, reviewed_at=now()
      where id = _s.id;
    _n := _n + 1;
  end loop;
  return _n;
end $$;

revoke all on function public.entity_suggestion_batches() from anon, public;
revoke all on function public.approve_entity_suggestion_batch(text,uuid,text,uuid) from anon, public;
grant execute on function public.entity_suggestion_batches() to authenticated, service_role;
grant execute on function public.approve_entity_suggestion_batch(text,uuid,text,uuid) to authenticated, service_role;
