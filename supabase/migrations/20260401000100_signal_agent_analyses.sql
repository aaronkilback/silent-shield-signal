create table if not exists signal_agent_analyses (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references signals(id) on delete cascade,
  agent_call_sign text not null,
  analysis text not null,
  confidence_score float,
  trigger_reason text,
  created_at timestamptz default now()
);

create index if not exists signal_agent_analyses_signal_id_idx
  on signal_agent_analyses(signal_id);

create index if not exists signal_agent_analyses_created_at_idx
  on signal_agent_analyses(created_at desc);
