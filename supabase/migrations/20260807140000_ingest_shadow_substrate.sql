-- WO-GATE-PHASE3-SHADOW-PLAN — substrate slice (1 of 7).
-- Shadow-only comparison table for the Phase 3 keyword-gate rebuild. The shadow matcher/scorer/
-- severity logic runs alongside the LIVE gate in both process-intelligence-document (RSS) and
-- ingest-signal, and writes ONLY here. There is NO signals write anywhere in the shadow path.
--
-- Named consumer (no-persistence-without-named-consumer rule): the 7-day cutover comparison query
-- (recall gain / FP rate / agreement / volume ceiling / severity dist / composite coverage /
-- geo_pending cost counter). Forward-only, no backfill, 30-day retention (purge cron follows in a
-- later slice). RLS-at-Creation: enabled, deny-by-default, service-role writes bypass — no policy
-- (nothing anon/authenticated reads this; it is operator/forensic analytics only).

create table if not exists public.ingest_shadow (
  id                          uuid primary key default gen_random_uuid(),

  -- item identity ------------------------------------------------------------
  path                        text        not null check (path in ('rss','ingest_signal')),
  source_id                   uuid,                     -- nullable: ingest_signal path may have no source row
  content_hash                text        not null,     -- sha256(title || source_url), same convention as ingest_decisions
  item_title                  text,
  item_url                    text,
  first_seen_at               timestamptz not null default now(),

  -- re-offer bookkeeping (forward-only; a re-offered item bumps counters, is not a new decision) --
  seen_count                  integer     not null default 1,
  last_seen_at                timestamptz not null default now(),

  -- LIVE side (what the current gate actually did) ---------------------------
  live_matched                boolean,                  -- did the live keyword gate attribute a client?
  live_client_id              uuid,
  live_outcome                text,                     -- live funnel outcome (e.g. no_client_match / below_threshold / inserted)
  live_severity               text,

  -- SHADOW side (what the new matcher/scorer/severity WOULD have done) --------
  shadow_matched              boolean,
  shadow_client_ids           uuid[],
  shadow_match_basis          text        check (shadow_match_basis is null or shadow_match_basis in ('semantic','token','asset_geo')),
  shadow_match_confidence     numeric,                  -- NULL = not evaluated; distinct from 0 = evaluated, no confidence
  shadow_geo_suppressed       boolean,                  -- asset-label matched but suppressed for geo_pending (Req1 fail-closed)
  shadow_asset_label          text,                     -- the common-noun asset label that (would have) matched, for the geo_pending cost counter
  shadow_composite_confidence numeric,
  shadow_tier2_eligible       boolean,                  -- would dispatch to review-signal-agent (composite >= 0.60)
  shadow_severity             text,
  shadow_severity_basis       text,
  shadow_corroboration_count  integer,                  -- independent corroborating sources; critical requires >= 2

  created_at                  timestamptz not null default now(),

  -- one row per item per path; re-offers UPSERT and bump seen_count/last_seen_at only
  constraint ingest_shadow_path_hash_uniq unique (path, content_hash)
);

comment on table public.ingest_shadow is
  'WO-GATE-PHASE3: shadow-only comparison of the new keyword-gate matcher/scorer/severity vs the live gate. NO signals writes originate here. Consumer = 7-day cutover comparison. Forward-only, 30-day retention. RLS deny-by-default; service-role/SECURITY-DEFINER writes only.';
comment on column public.ingest_shadow.shadow_match_confidence is
  'NULL = matcher never evaluated this (item,client); 0 = evaluated with zero confidence. NEVER coalesce the two (same discipline as ingest_decisions.relevance_score).';
comment on column public.ingest_shadow.shadow_geo_suppressed is
  'true = an asset-label match was found but suppressed because the client has no geo/entity anchor (geo_pending fail-closed). Powers the per-client geo_pending cost counter.';

-- windowing / retention / per-client rollups for the compare query
create index if not exists ingest_shadow_first_seen_idx  on public.ingest_shadow (first_seen_at);
create index if not exists ingest_shadow_path_seen_idx    on public.ingest_shadow (path, first_seen_at);
create index if not exists ingest_shadow_live_client_idx  on public.ingest_shadow (live_client_id);
-- geo_pending cost counter: partial index over the suppressed rows only
create index if not exists ingest_shadow_geo_suppressed_idx
  on public.ingest_shadow (shadow_asset_label)
  where shadow_geo_suppressed is true;

-- RLS-at-Creation standing rule: enable, no policy. Service-role writers bypass RLS; nothing
-- anon/authenticated reads this table (operator/forensic analytics only).
alter table public.ingest_shadow enable row level security;
