-- Canonical single source of truth for "an operationally-active incident".
-- Fixes the zombie-incident class: consumers each implemented their own status
-- allowlist/denylist over the incidents enum, so a soft-close (status='closed'
-- + outcome_type) written by WO-INCIDENT-QA was invisible to some queries and
-- visible to others (the exec brief had NO status filter at all). One definition,
-- every consumer converges — same doctrine as the findings single-source rule.
--
-- ACTIVE  = not deleted, not superseded (merged-away dup), not a test row,
--           and status is NOT terminal. Terminal = {resolved, closed}.
--           (open/acknowledged/contained/investigating/mitigated are all active.)

create or replace view public.active_incidents
with (security_invoker = true) as
select *
from public.incidents
where deleted_at is null
  and superseded_by is null
  and coalesce(is_test, false) = false
  and status::text not in ('resolved', 'closed');

comment on view public.active_incidents is
  'CANONICAL definition of an operationally-active incident (single source of truth). '
  'ACTIVE = deleted_at IS NULL AND superseded_by IS NULL AND is_test IS NOT TRUE AND '
  'status NOT IN (resolved, closed). security_invoker=true so it respects incidents RLS '
  '(no tenant-isolation bypass). Every "active/open incidents" consumer must read this view '
  '(or the is_incident_active() / isIncidentActive() mirrors) instead of a homemade status '
  'predicate. Terminal set lives here ONLY; growing the status enum does not re-break consumers.';

-- Status-only helper (for callers that only hold a status value, e.g. in-memory
-- filters via the TS mirror, or SQL predicates). Mirrors the view's terminal set.
create or replace function public.is_incident_active(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status is not null and p_status not in ('resolved', 'closed');
$$;

comment on function public.is_incident_active(text) is
  'Status-only half of the canonical active-incident definition (terminal = resolved, closed). '
  'The full definition (also excludes deleted/superseded/test rows) is the public.active_incidents view.';

grant select on public.active_incidents to authenticated, service_role;
grant execute on function public.is_incident_active(text) to authenticated, service_role, anon;
