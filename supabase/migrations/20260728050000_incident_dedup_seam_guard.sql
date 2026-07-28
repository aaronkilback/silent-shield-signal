-- G(c) 2026-07-28: single-point incident dedup guard (BEFORE INSERT trigger).
-- Incident creation is scattered across 11+ edge functions with no shared seam
-- (agent-chat, ingest-signal x2, check-incident-escalation, ai-decision-engine,
-- autonomous-operations-loop, monitor-entity-proximity, process-security-report,
-- parse-document, manage-incident-ticket + threat-cluster-detector /
-- detect-threat-patterns for the [PATTERN] clusters). Rather than guard 11 seams,
-- the dedup lives at the DB.
--
-- On INSERT, if an OPEN, non-superseded incident with the same client + normalized
-- title (which encodes the cluster id for [PATTERN] incidents) exists within 14
-- days, bump its duplicate_count/last_seen_at and SKIP the insert — "incident
-- identity persists, evidence accumulates" (operator ruling c). Applied prod
-- direct; verified (3 identical inserts -> 1 row, duplicate_count=3).
create or replace function public.dedup_incident_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_normt text;
  v_existing uuid;
begin
  if NEW.deleted_at is not null or coalesce(NEW.is_test, false) then return NEW; end if;
  if NEW.superseded_by is not null then return NEW; end if;
  v_normt := lower(regexp_replace(coalesce(NEW.title, ''), '[^a-zA-Z0-9]+', ' ', 'g'));
  if length(v_normt) <= 6 then return NEW; end if;

  select id into v_existing
  from public.incidents
  where superseded_by is null
    and deleted_at is null
    and coalesce(is_test, false) = false
    and client_id is not distinct from NEW.client_id
    and lower(regexp_replace(coalesce(title, ''), '[^a-zA-Z0-9]+', ' ', 'g')) = v_normt
    and opened_at >= coalesce(NEW.opened_at, now()) - interval '14 days'
  order by opened_at asc
  limit 1;

  if v_existing is not null then
    update public.incidents
       set duplicate_count = duplicate_count + 1,
           last_seen_at = greatest(coalesce(last_seen_at, opened_at), coalesce(NEW.opened_at, now()))
     where id = v_existing;
    raise notice 'INCIDENT_DEDUP_GUARD: collapsed duplicate "%" into %', left(NEW.title, 60), v_existing;
    return null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_dedup_incident_before_insert on public.incidents;
create trigger trg_dedup_incident_before_insert
  before insert on public.incidents
  for each row execute function public.dedup_incident_before_insert();
