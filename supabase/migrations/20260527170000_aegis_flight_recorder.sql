-- Aegis Flight Recorder — runtime chain-of-custody + retrieval observability (Priority 4).
-- ADR: docs/platform-operations/architecture-decisions/aegis-flight-recorder.md
-- Operator-forensic by default (RLS: super_admin read; service-role write). Redaction is
-- enforced in the capture seam (_shared/flight-recorder.ts): no secrets/tokens/raw embeddings.
-- PROPOSED schema — apply only after operator ratification.

-- ── 1. Request header (one row per request; debug_trace_id correlates everything) ──────────
create table if not exists public.aegis_request_trace (
  debug_trace_id      uuid primary key default gen_random_uuid(),
  request_id          text,
  conversation_id     uuid,
  tool_call_chain_id  uuid,
  tenant_id           uuid,                              -- scope (nullable: pre-auth/system)
  client_id           uuid,
  actor_user_id       uuid,
  actor_surface       text not null default 'aegis',     -- aegis | aegis_ops | agent
  function_name       text not null,
  status              text,                              -- ok | error | refused
  final_response_path text,                              -- streamed | fallback_empty | refused | error
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  duration_ms         integer,
  created_at          timestamptz not null default now()
);

-- ── 2. Prompt assembly ─────────────────────────────────────────────────────────────────────
create table if not exists public.aegis_prompt_trace (
  id                  uuid primary key default gen_random_uuid(),
  trace_id            uuid not null references public.aegis_request_trace(debug_trace_id) on delete cascade,
  tenant_id           uuid,
  system_prompt       text,                              -- redacted + truncated
  system_prompt_sha256 text,                             -- hash of the full assembled prompt
  context_blocks      jsonb not null default '[]'::jsonb,  -- [{name, size, sha256, object_ids}]
  injected_object_ids jsonb not null default '{}'::jsonb,  -- {entity_ids, signal_ids, source_ids, document_ids, report_ids}
  memory_injections   jsonb not null default '[]'::jsonb,
  grounding_markers   jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

-- ── 3. Retrieval chain (one row per retrieval) ──────────────────────────────────────────────
create table if not exists public.aegis_retrieval_trace (
  id                  uuid primary key default gen_random_uuid(),
  trace_id            uuid not null references public.aegis_request_trace(debug_trace_id) on delete cascade,
  tenant_id           uuid,
  surface             text not null,                     -- e.g. tenantRetrieve:entities | COP | match_cross_agent_memories | archival_documents
  query               text,                              -- redacted
  tenant_scope        uuid,
  returned_object_ids jsonb not null default '[]'::jsonb,
  vector_hits         jsonb not null default '[]'::jsonb,  -- [{id, similarity}] — NEVER raw embeddings
  fallback_path       text,                              -- rpc | keyword_fallback | none
  timing_ms           integer,
  provenance          jsonb not null default '{}'::jsonb,  -- scope key, row_ids
  created_at          timestamptz not null default now()
);

-- ── 4. Tool-call chain (one row per tool call) ──────────────────────────────────────────────
create table if not exists public.aegis_tool_trace (
  id                  uuid primary key default gen_random_uuid(),
  trace_id            uuid not null references public.aegis_request_trace(debug_trace_id) on delete cascade,
  tenant_id           uuid,
  sequence            integer,
  tool_name           text not null,
  args                jsonb not null default '{}'::jsonb,  -- redacted
  scoped_tenant_id    uuid,
  scoped_client_id    uuid,
  returned_object_count integer,
  refusal_reason      text,
  outcome             text,                              -- ok | error | refused
  timing_ms           integer,
  created_at          timestamptz not null default now()
);

-- ── 5. Grounding-state per answer segment ───────────────────────────────────────────────────
create table if not exists public.aegis_grounding_trace (
  id                  uuid primary key default gen_random_uuid(),
  trace_id            uuid not null references public.aegis_request_trace(debug_trace_id) on delete cascade,
  tenant_id           uuid,
  segment_index       integer not null,
  segment_text        text,
  grounding_state     text not null,                     -- retrieved | inferred_from_retrieved | unknown_unavailable
  source_object_ids   jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  constraint aegis_grounding_state_ck
    check (grounding_state in ('retrieved','inferred_from_retrieved','unknown_unavailable'))
);

-- ── Indexes ────────────────────────────────────────────────────────────────────────────────
create index if not exists idx_aegis_req_trace_tenant   on public.aegis_request_trace (tenant_id, created_at desc);
create index if not exists idx_aegis_req_trace_conv      on public.aegis_request_trace (conversation_id) where conversation_id is not null;
create index if not exists idx_aegis_prompt_trace_tid    on public.aegis_prompt_trace (trace_id);
create index if not exists idx_aegis_retrieval_trace_tid on public.aegis_retrieval_trace (trace_id);
create index if not exists idx_aegis_tool_trace_tid      on public.aegis_tool_trace (trace_id);
create index if not exists idx_aegis_grounding_trace_tid on public.aegis_grounding_trace (trace_id);

-- ── RLS: operator-forensic read (super_admin), service-role write ───────────────────────────
do $$
declare t text;
begin
  foreach t in array array['aegis_request_trace','aegis_prompt_trace','aegis_retrieval_trace','aegis_tool_trace','aegis_grounding_trace']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s operator read" on public.%I', t, t);
    execute format('create policy "%s operator read" on public.%I for select to authenticated using (is_super_admin(auth.uid()))', t, t);
    execute format('drop policy if exists "%s service manage" on public.%I', t, t);
    execute format('create policy "%s service manage" on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── Bounded retention (default 30 days) — redaction is enforced in the seam, so traces hold
--    only forensic metadata + redacted content. Purge cascades from the request header.
create or replace function public.purge_aegis_traces(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  delete from public.aegis_request_trace where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Incident replay (component 6): full reconstruction by debug_trace_id.
--    SECURITY INVOKER → RLS applies → operator-only (super_admin) reads; non-operators get nulls.
create or replace function public.aegis_trace_replay(p_trace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'request',   (select to_jsonb(r) from public.aegis_request_trace r where r.debug_trace_id = p_trace_id),
    'prompt',    (select jsonb_agg(to_jsonb(p) order by p.created_at) from public.aegis_prompt_trace p where p.trace_id = p_trace_id),
    'retrieval', (select jsonb_agg(to_jsonb(rt) order by rt.created_at) from public.aegis_retrieval_trace rt where rt.trace_id = p_trace_id),
    'tools',     (select jsonb_agg(to_jsonb(tt) order by tt.sequence) from public.aegis_tool_trace tt where tt.trace_id = p_trace_id),
    'grounding', (select jsonb_agg(to_jsonb(g) order by g.segment_index) from public.aegis_grounding_trace g where g.trace_id = p_trace_id)
  );
$$;

select cron.schedule('purge-aegis-traces-daily', '0 4 * * *', $$select public.purge_aegis_traces(30)$$);

