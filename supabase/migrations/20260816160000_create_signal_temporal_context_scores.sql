-- signal_temporal_context_scores — shadow output of the temporal-context scoring pass.
-- Mirror of hazard_pathway_scores, MINUS the relevance coupling: the hazard scorer caps
-- signals.relevance_score; this one NEVER touches relevance_score and NEVER touches the
-- admission gate. Pure shadow — a row is written ONLY when a signal's date falls inside a
-- client_scheduled_conditions window (no window ⇒ no row, not a factor of 1).
--
-- Form (b) per operator scoping 2026-08-16: a separate score_signal_temporal_context pass
-- mirroring the hazard pathway. Table built now; the scoring FUNCTION (which encodes the
-- factor numbers) is staged pending the factor ruling.
create table if not exists public.signal_temporal_context_scores (
  id                   uuid primary key default gen_random_uuid(),
  signal_id            uuid not null references public.signals(id) on delete cascade,
  client_id            uuid not null references public.clients(id) on delete cascade,
  matched_condition_id uuid references public.client_scheduled_conditions(id) on delete set null,
  condition_type       text,                          -- e.g. 'venue_event'  (≈ hazard.category)
  matched_label        text,                          -- the event name       (≈ hazard.matched_place)
  in_window            boolean not null default true, -- always true for a persisted row (≈ hazard.has_pathway)
  event_class          text,                          -- concert/cfl/mls/cricket/community (≈ hazard.pathway_type)
  load_band            text,                          -- full_bowl..minor      (≈ hazard.nearest_asset qualitative)
  factor               numeric,                       -- temporal-context factor (≈ hazard.capped_relevance numeric out)
  window_start         date,
  window_end           date,
  reasoning            text,
  created_at           timestamptz not null default now()
);

alter table public.signal_temporal_context_scores enable row level security;
-- deny-by-default: NO policy. Service-role writers bypass RLS; anon/authenticated see nothing.

create index if not exists signal_temporal_context_scores_signal_idx
  on public.signal_temporal_context_scores (signal_id);
create index if not exists signal_temporal_context_scores_client_idx
  on public.signal_temporal_context_scores (client_id);

comment on table public.signal_temporal_context_scores is
  'Shadow output of score_signal_temporal_context (temporal twin of hazard_pathway_scores). Row written ONLY when a signal date lands inside a client_scheduled_conditions window. NEVER touches relevance_score or the admission gate. Service-role write only, RLS deny-by-default.';
