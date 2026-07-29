-- WO-INCIDENT-QA Step 1: per-evaluation audit trail for the incident-creation gate.
-- Named consumers: QA watchdog probe set (Step 5) + operator 7-day evidence queries.
-- "No more unauditable gates anywhere" (2026-07-28 ruling).
create table if not exists public.incident_gate_decisions (
  id               uuid primary key default gen_random_uuid(),
  signal_id        uuid,
  caller_function  text not null,          -- 'check-incident-escalation' | 'ai-decision-engine'
  admitted         boolean not null,
  branch           text not null,          -- pattern_excluded | hazard_frozen | relevance_below
                                            -- | confidence_below | confidence_null_uncorroborated
                                            -- | admit_confidence | admit_corroboration_fallback
  reason           text,
  category         text,
  signal_type      text,
  signal_origin    text,
  relevance_score  numeric,
  confidence       numeric,                 -- composite_confidence ?? confidence (whichever present)
  confidence_present boolean,
  corroboration_count int,
  assigned_priority text,                   -- p1|p2|p3 when admitted, null otherwise
  incident_id      uuid,                    -- set when an incident was actually created
  created_at       timestamptz not null default now()
);

create index if not exists idx_incident_gate_decisions_created_at
  on public.incident_gate_decisions (created_at desc);
create index if not exists idx_incident_gate_decisions_branch
  on public.incident_gate_decisions (branch);

-- RLS-at-Creation Standing Rule: enabled at creation, deny-by-default.
-- Service-role writers (edge functions) bypass RLS; QA probe reads via service-role.
alter table public.incident_gate_decisions enable row level security;
