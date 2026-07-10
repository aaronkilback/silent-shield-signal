-- WO-DATA-INTEGRITY structural contamination fix (2026-07-10)
-- Follows the live finding chain: Cascade (is_test client) beliefs reachable in Petronas
-- AEGIS retrieval, then _legacy_test_tenant_2026_03_12 surfacing in the AEGIS org list.
-- Root: is_test entities were not excluded from (a) agent-memory retrieval and
-- (b) accessible-client / tenant enumeration.
--
-- DEPLOY ORDER (post-merge): apply THIS migration FIRST, then deploy get-user-tenants +
-- system-watchdog (the edge fns reference the new is_test columns).

-- ── SLICE 1: agent_investigation_memory.is_test (durable marker) ─────────────────────────
alter table public.agent_investigation_memory
  add column if not exists is_test boolean not null default false;

-- backfill: any belief whose owning client is a test client is a test belief
update public.agent_investigation_memory m
  set is_test = true
  from public.clients c
  where m.client_id = c.id and c.is_test = true and m.is_test = false;

-- ── SLICE 4a: tenants.is_test (mirror the client-level flag) ─────────────────────────────
-- tenants.status is uniformly 'active' and cannot distinguish test/legacy; add is_test.
alter table public.tenants
  add column if not exists is_test boolean not null default false;

-- one-time backfill of the known test/legacy tenants by name pattern; is_test is the
-- durable flag thereafter (no runtime name-matching anywhere).
update public.tenants
  set is_test = true
  where is_test = false
    and name ~* '(^_)|legacy|test|_qa|_dryrun|_benchmark|_invariant|smoketest|fixture|sandbox';

-- ── SLICE 3: get_user_accessible_client_ids excludes is_test clients (is_test ONLY) ──────
-- NB (operator-ratified): is_test filter ONLY. Do NOT add a status filter here — hiding
-- offboarded (status='inactive') real clients' history from their own operators is a
-- product decision about offboarding, not a contamination fix, and must arrive as its own
-- deliberate change with its own blast-radius pass. This function backs ~200 RLS policies
-- across ~90 tables (see PR body); the is_test predicate is the minimal safe change.
create or replace function public.get_user_accessible_client_ids()
returns table(client_id uuid)
language sql stable security definer
as $function$
  select c.id
  from public.clients c
  inner join public.tenant_users tu on tu.tenant_id = c.tenant_id
  where tu.user_id = auth.uid()
    and coalesce(c.is_test, false) = false
$function$;

-- ── SLICE 2: match_agent_memories (investigation overload) excludes is_test beliefs ─────
-- Defense-in-depth: even if a quarantined belief's tenant_id were restored, is_test excludes it.
create or replace function public.match_agent_memories(
  p_agent text,
  p_query_embedding vector,
  p_match_threshold double precision default 0.65,
  p_match_count integer default 10,
  p_tenant_id uuid default null::uuid
)
returns table(id uuid, content text, memory_type text, entities text[], confidence numeric, incident_id uuid, similarity double precision)
language sql stable security definer
set search_path to 'public'
as $function$
  select m.id, m.content, m.memory_type, m.entities, m.confidence, m.incident_id,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from agent_investigation_memory m
  where m.agent_call_sign = p_agent
    and coalesce(m.is_test, false) = false
    and m.tenant_id is not null and m.tenant_id = p_tenant_id
    and m.embedding is not null and (m.expires_at is null or m.expires_at > now())
    and 1 - (m.embedding <=> p_query_embedding) > p_match_threshold
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
$function$;
