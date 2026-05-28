-- INC-OMCR — Ownerless Memory Cross-Tenant Retrieval (P0, under INC-CTX-CONTAM)
-- Forensic: 1,079/1,323 agent_investigation_memory rows are client_id=NULL (ownerless);
-- 177 are embedding-indexed and served cross-tenant by match_cross_agent_memories /
-- match_agent_memories (SECURITY DEFINER, NO tenant filter). The exact BCH phrase lives
-- in such an ownerless document_intake row derived from a Petronas (other-tenant) PDF.
--
-- This migration anchors ownership + retrieval scoping on a denormalized tenant_id:
--   (1) add tenant_id; (2) backfill derivable rows; (3) quarantine the rest (tenant_id
--   stays NULL → excluded by scoped retrieval); (4) fail-closed write trigger (DB-level,
--   non-bypassable backstop — service-role is untrusted); (5) scope BOTH match RPCs by
--   tenant (fail closed: NULL/absent p_tenant_id → zero rows, never a global match).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Denormalized tenant ownership column (table previously had only client_id).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agent_investigation_memory add column if not exists tenant_id uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill ownership where provable.
-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. Rows that already carry client_id → tenant via clients.
update public.agent_investigation_memory aim
set tenant_id = c.tenant_id
from public.clients c
where aim.client_id = c.id
  and aim.tenant_id is null
  and c.tenant_id is not null;

-- 2b. Ownerless 'investigation' rows → derive from incident (also restore client_id).
update public.agent_investigation_memory aim
set tenant_id = i.tenant_id,
    client_id = coalesce(aim.client_id, i.client_id)
from public.incidents i
where aim.incident_id = i.id
  and aim.tenant_id is null
  and i.tenant_id is not null;

-- 2c. Ownerless 'document_intake' rows → derive from the source archival document by the
--     filename embedded in the memory content ('DOCUMENT INTAKE: "<filename>"').
update public.agent_investigation_memory aim
set tenant_id = c.tenant_id,
    client_id = coalesce(aim.client_id, ad.client_id)
from public.archival_documents ad
join public.clients c on c.id = ad.client_id
where aim.tenant_id is null
  and aim.memory_type = 'document_intake'
  and c.tenant_id is not null
  and ad.filename = substring(aim.content from 'DOCUMENT INTAKE: "([^"]+)"');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Quarantine the unresolved remainder. tenant_id stays NULL (→ excluded by every
--    scoped read below); tag for audit/forensics.
-- ─────────────────────────────────────────────────────────────────────────────
update public.agent_investigation_memory
set tags = array_append(coalesce(tags, '{}'::text[]), 'quarantine_ownerless')
where tenant_id is null
  and not ('quarantine_ownerless' = any(coalesce(tags, '{}'::text[])));

create index if not exists idx_aim_tenant on public.agent_investigation_memory (tenant_id)
  where tenant_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fail-closed write backstop (non-bypassable; service-role bypasses RLS but NOT
--    triggers). Derive tenant from client_id when possible; refuse genuinely ownerless writes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.aim_require_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tenant_id is null and new.client_id is not null then
    select c.tenant_id into new.tenant_id from public.clients c where c.id = new.client_id;
  end if;
  if new.tenant_id is null and new.incident_id is not null then
    select i.tenant_id into new.tenant_id from public.incidents i where i.id = new.incident_id;
  end if;
  if new.tenant_id is null then
    raise exception 'agent_investigation_memory: ownerless write refused — tenant_id required (INC-OMCR ownership integrity). Pass a resolvable client_id/incident_id or tenant_id.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aim_require_tenant on public.agent_investigation_memory;
create trigger trg_aim_require_tenant
  before insert on public.agent_investigation_memory
  for each row execute function public.aim_require_tenant();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Scope the retrieval RPCs by tenant. p_tenant_id LAST + DEFAULT NULL keeps the
--    signatures backward-compatible; the predicate `tenant_id IS NOT NULL AND
--    tenant_id = p_tenant_id` means NULL/absent p_tenant_id returns ZERO rows (fail
--    closed) and quarantined (NULL-tenant) rows are never returned.
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP the prior unscoped signatures first — adding p_tenant_id is a NEW overload, so a
-- bare CREATE OR REPLACE would leave the old unscoped function callable. (The unrelated
-- agent_conversation_memory overload match_agent_memories(uuid,...) is left intact.)
drop function if exists public.match_agent_memories(text, vector, double precision, integer);
drop function if exists public.match_cross_agent_memories(text, text, double precision, int);

create or replace function public.match_agent_memories(
  p_agent TEXT,
  p_query_embedding vector(1536),
  p_match_threshold DOUBLE PRECISION DEFAULT 0.65,
  p_match_count INTEGER DEFAULT 10,
  p_tenant_id uuid DEFAULT NULL
)
returns table(id UUID, content TEXT, memory_type TEXT, entities TEXT[], confidence NUMERIC, incident_id UUID, similarity DOUBLE PRECISION)
language sql
stable
security definer
set search_path to 'public'
as $$
  SELECT
    m.id, m.content, m.memory_type, m.entities, m.confidence, m.incident_id,
    1 - (m.embedding <=> p_query_embedding) AS similarity
  FROM agent_investigation_memory m
  WHERE m.agent_call_sign = p_agent
    AND m.tenant_id IS NOT NULL AND m.tenant_id = p_tenant_id   -- INC-OMCR tenant scope (fail closed)
    AND m.embedding IS NOT NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND 1 - (m.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

create or replace function public.match_cross_agent_memories(
  p_exclude_agent TEXT,
  p_query_embedding TEXT,
  p_match_threshold DOUBLE PRECISION DEFAULT 0.70,
  p_match_count INT DEFAULT 15,
  p_tenant_id uuid DEFAULT NULL
)
returns table(id UUID, agent_call_sign TEXT, content TEXT, memory_type TEXT, confidence DOUBLE PRECISION, entities TEXT[], incident_id UUID, similarity DOUBLE PRECISION)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  select
    aim.id, aim.agent_call_sign, aim.content, aim.memory_type, aim.confidence::DOUBLE PRECISION,
    aim.entities, aim.incident_id,
    1 - (aim.embedding::vector(1536) <=> p_query_embedding::vector(1536)) as similarity
  from agent_investigation_memory aim
  where aim.agent_call_sign != p_exclude_agent
    and aim.tenant_id is not null and aim.tenant_id = p_tenant_id   -- INC-OMCR tenant scope (fail closed)
    and aim.embedding is not null
    and (aim.expires_at is null or aim.expires_at > now())
    and 1 - (aim.embedding::vector(1536) <=> p_query_embedding::vector(1536)) > p_match_threshold
  order by similarity desc
  limit p_match_count;
end;
$$;
