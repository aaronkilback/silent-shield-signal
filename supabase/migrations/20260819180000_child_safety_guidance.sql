-- Section 6 · Family & Child Safety — operator-editable authored guidance (B/C). Records not code, so
-- safety guidance can be edited without a deploy and reviewed by counsel / a child-safety professional.
-- Contains ZERO child data — generic authored guidance only. (6A household-exposure FINDINGS reuse
-- subject_exposure_items with category='household_exposure', redacted; this table is B/C content.)
create table if not exists public.child_safety_guidance (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('framing','platform','cross_platform','protocol','escalation')),
  key text not null,                         -- platform slug or item slug
  title text not null,
  content jsonb not null,                    -- shape varies by section
  display_order int not null default 100,
  is_emergency boolean not null default false,   -- e.g. sextortion — render as an emergency block
  version int not null default 1,
  review_interval_months int not null default 6, -- escalation rows use 3 (emergency contacts must not go stale)
  last_reviewed_at timestamptz not null default now(),
  reviewed_by text,                          -- 'DRAFT — pending professional review' until a human signs it
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint child_safety_guidance_uq unique (section, key)
);
-- RLS-at-Creation: deny-by-default, service-role only (report generator reads; editor fn writes).
alter table public.child_safety_guidance enable row level security;
create index if not exists csg_active_section_idx on public.child_safety_guidance (section, display_order) where is_active;

-- Staleness / draft probe (agent-sentinel calls this). DRAFT is stale BY DEFINITION regardless of age
-- (operator addition 2); escalation rows carry a shorter interval (seeded at 3 months, addition 3).
create or replace function public.child_safety_guidance_stale()
returns table(id uuid, section text, key text, title text, reason text, last_reviewed_at timestamptz, reviewed_by text)
language sql security definer set search_path = public as $$
  select id, section, key, title,
    case
      when reviewed_by is null or reviewed_by ilike 'DRAFT%' then 'draft_unreviewed'
      else 'review_interval_exceeded'
    end as reason,
    last_reviewed_at, reviewed_by
  from public.child_safety_guidance
  where is_active
    and (
      reviewed_by is null or reviewed_by ilike 'DRAFT%'
      or last_reviewed_at < now() - make_interval(months => review_interval_months)
    );
$$;
-- anon-surface doctrine: SECURITY DEFINER must not be anon/authenticated-executable.
revoke all on function public.child_safety_guidance_stale() from anon, authenticated;
