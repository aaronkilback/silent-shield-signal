-- Operator ask (2026-08-10): give every containment a VISIBLE disposition (owner +
-- review date + lift condition), not an indefinite one. The registry already existed
-- (29 rows: 3 belief-store freezes + ~26 INC-AITOOLS 503s) with reason/since/
-- expected_resolution but NO owner and NO next_review_at — so even tracked holds had no
-- cadence. And the entity LEGAL HOLD (788+15+2 records) was never entered at all.
-- Applied via MCP; committed for repo parity. See feedback_untracked_containment_becomes_permanent.

alter table public.containment_registry add column if not exists owner uuid;
alter table public.containment_registry add column if not exists owner_label text;
alter table public.containment_registry add column if not exists last_reviewed_at timestamptz;
alter table public.containment_registry add column if not exists next_review_at timestamptz;
alter table public.containment_registry add column if not exists review_notes text;

alter table public.containment_registry drop constraint if exists containment_registry_subject_type_check;
alter table public.containment_registry add constraint containment_registry_subject_type_check
  check (subject_type in ('edge_function','store_freeze','legal_hold','kill_switch','quarantine','other'));

-- Data applied via execute_sql (not repeated here):
--  • INSERT the missing INC-AITOOLS-XTENANT legal_hold row (805 records; owner=operator;
--    next_review_at 2026-08-24; lift = PIPEDA determination + third-party review).
--  • UPDATE the 3 store_freeze rows with owner + next_review_at 2026-08-24 (had none).

-- Stale-containment probe: active containment (frozen / contained_503) overdue or never
-- scheduled for review. Wired into agent-sentinel Probe 2g (one aggregated LOW finding).
create or replace function public.containment_stale_check()
returns table(subject_type text, subject text, state text, since date,
  days_since_review numeric, next_review_at timestamptz, stale_reason text, owner_label text)
language sql stable security definer set search_path = public as $$
  select cr.subject_type, cr.subject, cr.state, cr.since,
    round(extract(epoch from (now() - coalesce(cr.last_reviewed_at, cr.since::timestamptz)))/86400, 1) as days_since_review,
    cr.next_review_at,
    case when cr.next_review_at is null then 'no_review_scheduled'
         when cr.next_review_at < now() then 'review_overdue'
         else 'ok' end as stale_reason,
    cr.owner_label
  from public.containment_registry cr
  where cr.state in ('frozen','contained_503')
    and (cr.next_review_at is null or cr.next_review_at < now())
  order by coalesce(cr.last_reviewed_at, cr.since::timestamptz) asc
$$;

revoke all on function public.containment_stale_check() from anon, public;
grant execute on function public.containment_stale_check() to authenticated, service_role;
