-- WO-PROVENANCE-01 / WO-PARTITION-01 — source provenance model (DDL; classification data is
-- operator-curated and applied live, not reproduced here).
do $$ begin
  if not exists (select 1 from pg_type where typname='publisher_kind') then
    create type publisher_kind as enum ('outlet','aggregator','sensor','internal','social','unknown');
  end if;
end $$;
alter type publisher_kind add value if not exists 'official';
alter type publisher_kind add value if not exists 'wire';
alter type publisher_kind add value if not exists 'advocacy';
alter type publisher_kind add value if not exists 'subject';
alter type publisher_kind add value if not exists 'commentary';

alter table public.sources add column if not exists publisher_kind publisher_kind;
alter table public.sources add column if not exists publisher_name text;
alter table public.sources add column if not exists publisher_entity_id text;
alter table public.sources add column if not exists engagement_id text;
alter table public.sources add column if not exists provenance_path text;

comment on column public.sources.publisher_kind is 'official/wire/outlet/aggregator/sensor/advocacy/subject/commentary/social/internal/unknown — each maps to a distinct citability rule (WO-PARTITION-01 B).';
comment on column public.sources.publisher_name is 'Masthead(outlet)/operator(sensor)/authority(official)/wire name; NULL for aggregator (per-item) and generally.';
comment on column public.sources.publisher_entity_id is 'Canonical org slug so dedup collapses across feeds.';
comment on column public.sources.engagement_id is 'Owning engagement: SHARED | CRT (BC Place / Vancouver 2026) | PECL. No engagements table exists (finding); text sentinel.';
comment on column public.sources.provenance_path is 'url | api_endpoint | none. none => NON-CITABLE (enforcement deferred to step 2).';
