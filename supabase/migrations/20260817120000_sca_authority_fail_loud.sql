-- WO-ATTRIBUTION-AUTHORITY-DEFAULT-01 — constraint pass (RULED Option 2 + partial-unique index).
-- Separate pass from the writer/template correction (per operator: writers first, verified, then
-- the constraint). Pre-flip verified 2026-08-17: 0 null is_authoritative, 0 (signal,client) pairs
-- with >1 authoritative row — so both statements apply cleanly to existing data.
--
-- Purpose: make an OMITTED authority judgement fail LOUD at insert instead of silently defaulting
-- to false (the 2026-08-14 failure mode) — same discipline as ingest_decisions "NULL = never
-- scored, never coalesce". There are ZERO code writers today, so this cannot break a live writer;
-- its entire value is future writers (manual re-attribution runs + the planned code writers).

-- (1) Remove the default so an omitting insert yields NULL (not false).
alter table public.signal_client_attributions alter column is_authoritative drop default;

-- (2) NOT NULL: an omitting insert now errors instead of minting a silently-non-authoritative row.
alter table public.signal_client_attributions alter column is_authoritative set not null;

-- (3) Enforce the invariant the supersede mechanism assumes: at most ONE authoritative row per
--     (signal_id, client_id). A second authoritative insert for the same pair now errors —
--     forcing supersede, not duplicate.
create unique index if not exists uq_sca_one_authoritative_per_signal_client
  on public.signal_client_attributions (signal_id, client_id)
  where is_authoritative;

comment on index public.uq_sca_one_authoritative_per_signal_client is
  'One authoritative attribution per (signal,client). WO-ATTRIBUTION-AUTHORITY-DEFAULT-01. A second authoritative insert for the same pair errors — supersede the prior row, do not duplicate.';
