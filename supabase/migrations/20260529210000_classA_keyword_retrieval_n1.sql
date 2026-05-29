-- Class A N+1 — keyword retrieval (Postgres FTS + ts_rank_cd).
-- Operator-approved 2026-05-29. Replaces random-3 retrieval in dashboard-ai-assistant
-- with relevance-based keyword retrieval. Empty-result discipline is the load-bearing
-- rule: tradecraft appears ONLY when a topical match exists above the threshold.
--
-- Reversible: drop function + drop index + alter table drop column.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Generated tsvector column on agent_tradecraft.
--    Includes: hypothesis (the methodology text) + domain (one of 5 enum values)
--    + related_domains (text[]) + title. Excludes authored_by_agent (codename
--    like "JOCKO" / "CRUCIBLE" — not a topical operator query term).
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: Postgres rejects the generated-column variant because coalesce / array_to_string
-- carry a STABLE classification in this Postgres build. Standard pattern: plain column
-- maintained by trigger. Same end-state; just two fewer constraints on the column type.
alter table public.agent_tradecraft add column hypothesis_search tsvector;

create or replace function public.agent_tradecraft_update_search()
returns trigger language plpgsql as $$
begin
  new.hypothesis_search := to_tsvector('english'::regconfig,
    coalesce(new.hypothesis, '') || ' ' ||
    coalesce(new.domain, '') || ' ' ||
    coalesce(array_to_string(new.related_domains, ' '), '') || ' ' ||
    coalesce(new.title, '')
  );
  return new;
end;
$$;

create trigger trg_at_update_search
  before insert or update of hypothesis, domain, related_domains, title
  on public.agent_tradecraft
  for each row execute function public.agent_tradecraft_update_search();

-- Backfill existing rows (touch each row so the trigger fires)
update public.agent_tradecraft set hypothesis = hypothesis;

create index idx_at_search on public.agent_tradecraft using gin (hypothesis_search);

comment on column public.agent_tradecraft.hypothesis_search is
  'Generated tsvector for keyword retrieval (N+1, 2026-05-29). plainto_tsquery + ts_rank_cd; threshold gate in retrieve_tradecraft_keyword RPC.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. retrieve_tradecraft_keyword(query, threshold, budget, min_confidence)
--    Returns 0..budget items ranked by ts_rank_cd. EMPTY RESULT IS VALID.
--    No padding to budget. Threshold gate is the operator-locked rule.
--
--    Threshold is tunable via the p_threshold parameter; caller decides.
--    Per operator: "tradecraft appears ONLY when it materially improves
--    reasoning, recommendation quality, or decision support."
-- ─────────────────────────────────────────────────────────────────────────────
-- p_threshold default 0.25 chosen by calibration against 5 validation scenarios
-- + 2 off-topic queries on prod data (2026-05-29). At this threshold:
--   on-topic queries with library coverage → 3 items (S1/S2/S4/S5)
--   on-topic queries WITHOUT library coverage → 0 items (S3 travel-security gap)
--   off-topic queries ("weather", "hello") → 0 items
-- Methodology: plainto_tsquery for stemming + stopwords; then swap AND → OR so
-- chat queries match documents containing ANY relevant token; ts_rank_cd ranks
-- by overlap density. Tuning rule: raise if false-positives > 20% in 7-day
-- Flight Recorder review; lower if false-negatives > 20%.
create or replace function public.retrieve_tradecraft_keyword(
  p_query          text,
  p_threshold      real default 0.25,
  p_budget         int default 3,
  p_min_confidence real default 0.80
)
returns table(
  id                  uuid,
  authored_by_agent   text,
  domain              text,
  hypothesis          text,
  confidence          numeric,
  provenance_resolved boolean,
  rank                real
)
language sql
security definer
set search_path to 'public'
as $$
  with q as (
    -- plainto_tsquery handles stemming + stopwords; swap AND → OR so chat
    -- queries match docs containing ANY relevant token. Stopword-only or
    -- empty queries produce empty tsquery; we coerce to NULL so the WHERE
    -- clause returns 0 rows (empty-result discipline).
    select case
      when length(plainto_tsquery('english', p_query)::text) = 0 then null::tsquery
      else to_tsquery('english', replace(plainto_tsquery('english', p_query)::text, ' & ', ' | '))
    end as tsq
  )
  select
    t.id,
    t.authored_by_agent,
    t.domain,
    t.hypothesis,
    t.confidence,
    t.provenance_resolved,
    ts_rank_cd(t.hypothesis_search, q.tsq)::real as rank
  from public.agent_tradecraft t, q
  where q.tsq is not null
    and t.is_active = true
    and t.anonymization_status in ('passed', 'passed_provenance_unknown', 'passed_after_review')
    and t.confidence >= p_min_confidence
    and q.tsq @@ t.hypothesis_search
    and ts_rank_cd(t.hypothesis_search, q.tsq) >= p_threshold
  order by ts_rank_cd(t.hypothesis_search, q.tsq) desc
  limit greatest(p_budget, 0);
$$;

grant execute on function public.retrieve_tradecraft_keyword(text, real, int, real)
  to authenticated, service_role;

comment on function public.retrieve_tradecraft_keyword(text, real, int, real) is
  'Class A keyword retrieval. plainto_tsquery + ts_rank_cd. Empty-result valid (no padding to budget). Operator directive 2026-05-29: tradecraft appears only when threshold met.';

-- ROLLBACK:
-- drop function if exists public.retrieve_tradecraft_keyword(text, real, int, real);
-- drop index if exists public.idx_at_search;
-- alter table public.agent_tradecraft drop column if exists hypothesis_search;
