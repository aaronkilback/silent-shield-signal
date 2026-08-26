-- WO-ATTRIBUTION-PERSIST-02 (2026-08-25) — component 2 of 3: the gate audit ledger.
-- Two operator requirements this table serves (both are "the failure is silence" guards):
--   (a) DOWNGRADES MUST BE REVIEWABLE — a mis-filed real threat born 'none' is invisible unless
--       we can list what was downgraded in a period, with the reason. idx on (decided_at) where
--       downgraded gives that query directly.
--   (b) TIEBREAKER MUST LOG DECISION + INPUT — if the LLM nexus gate drifts we want the evidence
--       (llm_input = exact text/prompt sent; llm_output = raw decision), not a conclusion.
-- Per the No-Unauditable-Gates standing rule: every gate evaluation persists its branch + values.
create table if not exists public.attribution_gate_decisions (
  id                        uuid primary key default gen_random_uuid(),
  signal_id                 uuid not null references public.signals(id) on delete cascade,
  client_id                 uuid not null references public.clients(id) on delete cascade,
  attribution_id            uuid references public.signal_client_attributions(id) on delete set null,
  decided_at                timestamptz not null default now(),
  -- which branch decided: deterministic_nexus | deterministic_coverage | llm_tiebreaker
  --                       | llm_unavailable_downgrade | llm_error_downgrade
  gate_path                 text not null,
  verdict                   text not null check (verdict in ('direct','none')),
  downgraded                boolean not null,           -- true = venue name match did NOT become direct
  reason                    text,
  deterministic_nexus_terms text[],                     -- security terms that fired (if any)
  llm_input                 text,                       -- exact text/prompt sent to the tiebreaker
  llm_output                jsonb,                      -- raw tiebreaker decision
  llm_model                 text,
  matcher_version           text,
  created_at                timestamptz not null default now()
);

comment on table public.attribution_gate_decisions is
  'Audit ledger for the venue attribution nexus gate (WO-ATTRIBUTION-PERSIST-02). One row per gate '
  'evaluation. Downgrades (born none, not direct) are reviewable by period via idx_agd_downgraded_time; '
  'llm_input/llm_output capture the tiebreaker decision + its input for drift forensics.';

create index if not exists idx_agd_downgraded_time on public.attribution_gate_decisions (decided_at) where downgraded;
create index if not exists idx_agd_signal on public.attribution_gate_decisions (signal_id);
create index if not exists idx_agd_client_time on public.attribution_gate_decisions (client_id, decided_at);

-- RLS-at-Creation: deny-by-default, no policy. Writers/readers are service-role (bypass RLS).
alter table public.attribution_gate_decisions enable row level security;
