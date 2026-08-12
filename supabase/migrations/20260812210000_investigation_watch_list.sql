-- Investigation entity watch-list + cross-file link mechanism (WO scope 2026-08-12).
-- Closed investigation -> entity_watch_list (monitor level; no attribution dependency).
-- Watched entity reappearing in a later signal/investigation -> watch_list_link_events (names both files).
-- Applied to prod 2026-08-12 via execute_sql; this file captures it for git/DR parity.

alter table public.entity_watch_list add column if not exists source_investigation_id uuid references public.investigations(id);
create index if not exists idx_ewl_source_investigation on public.entity_watch_list(source_investigation_id);

create table if not exists public.watch_list_link_events (
  id uuid primary key default gen_random_uuid(),
  watch_entity_id uuid not null,
  entity_name text,
  source_investigation_id uuid references public.investigations(id),
  source_file_number text,
  matched_type text not null,           -- 'investigation' | 'signal'
  matched_ref uuid,
  matched_file_number text,
  match_basis text not null,            -- 'entity_id' | 'name'
  notify_user_id uuid,                  -- named consumer: the source file author
  created_at timestamptz default now()
);
alter table public.watch_list_link_events enable row level security;  -- RLS-at-Creation; service-role writes, deny-by-default
create unique index if not exists uq_wll_event on public.watch_list_link_events(source_investigation_id, watch_entity_id, matched_type, matched_ref, match_basis);

-- FORWARD 1: on investigation close, add its structured entities to the watch list.
create or replace function public.trg_close_inv_to_watchlist() returns trigger language plpgsql security definer as $fn$
begin
  if NEW.file_status='closed' and (OLD.file_status is distinct from 'closed') and NEW.correlated_entity_ids is not null then
    insert into public.entity_watch_list (entity_id, entity_name, client_id, source_investigation_id, watch_level, reason, added_by, added_by_type, is_active)
    select distinct e.id, e.name, NEW.client_id, NEW.id, 'monitor', 'Auto-added on investigation close: '||NEW.file_number, NEW.prepared_by, 'agent', true
    from unnest(NEW.correlated_entity_ids) cid join public.entities e on e.id=cid
    where not exists (select 1 from public.entity_watch_list w where w.entity_id=e.id and w.source_investigation_id=NEW.id);
  end if;
  return NEW;
end $fn$;
drop trigger if exists trg_close_inv_watchlist on public.investigations;
create trigger trg_close_inv_watchlist after update on public.investigations for each row execute function public.trg_close_inv_to_watchlist();

-- FORWARD 2: a new signal mention of a watched entity -> link event to the source file author.
create or replace function public.trg_watchlist_link_on_mention() returns trigger language plpgsql security definer as $fn$
begin
  insert into public.watch_list_link_events (watch_entity_id, entity_name, source_investigation_id, source_file_number, matched_type, matched_ref, matched_file_number, match_basis, notify_user_id)
  select w.entity_id, w.entity_name, w.source_investigation_id, si.file_number, 'signal', NEW.signal_id, null, 'entity_id', si.prepared_by
  from public.entity_watch_list w join public.investigations si on si.id=w.source_investigation_id
  where w.entity_id=NEW.entity_id and w.is_active
  on conflict (source_investigation_id, watch_entity_id, matched_type, matched_ref, match_basis) do nothing;
  return NEW;
end $fn$;
drop trigger if exists trg_ewl_link_mention on public.entity_mentions;
create trigger trg_ewl_link_mention after insert on public.entity_mentions for each row execute function public.trg_watchlist_link_on_mention();

-- FORWARD 3: a watched entity appearing in ANOTHER investigation (correlated entity_id OR name in
-- synopsis/information) -> link event naming both files. Covers "later investigation".
create or replace function public.trg_watchlist_link_on_investigation() returns trigger language plpgsql security definer as $fn$
begin
  insert into public.watch_list_link_events (watch_entity_id, entity_name, source_investigation_id, source_file_number, matched_type, matched_ref, matched_file_number, match_basis, notify_user_id)
  select w.entity_id, w.entity_name, w.source_investigation_id, si.file_number, 'investigation', NEW.id, NEW.file_number,
         case when NEW.correlated_entity_ids @> array[w.entity_id] then 'entity_id' else 'name' end, si.prepared_by
  from public.entity_watch_list w join public.investigations si on si.id=w.source_investigation_id
  where w.is_active and w.source_investigation_id <> NEW.id
    and (NEW.correlated_entity_ids @> array[w.entity_id]
         or (length(w.entity_name) >= 4 and (NEW.synopsis ilike '%'||w.entity_name||'%' or NEW.information ilike '%'||w.entity_name||'%')))
  on conflict (source_investigation_id, watch_entity_id, matched_type, matched_ref, match_basis) do nothing;
  return NEW;
end $fn$;
drop trigger if exists trg_ewl_link_investigation on public.investigations;
create trigger trg_ewl_link_investigation after insert or update on public.investigations for each row execute function public.trg_watchlist_link_on_investigation();
