-- CANONICAL re-attribution template for signal_client_attributions.
-- This file is the corrected successor to the ad-hoc SQL used on 2026-08-12 / 08-14.
-- The 2026-08-14 PECL run OMITTED is_authoritative → rows defaulted to false → the brief
-- read non-authoritative rows (WO-ATTRIBUTION-AUTHORITY-DEFAULT-01, INC ITEM 1). This template
-- ALWAYS sets is_authoritative EXPLICITLY. After the constraint pass (NOT NULL, no default),
-- omitting it will error at insert — this template is the compliant writer.
--
-- The table is append-only (trg_sca_append_only blocks UPDATE/DELETE). To make a row
-- authoritative you INSERT a new row with is_authoritative=true and supersedes=<prior row id>.
-- One-authoritative-per-(signal_id,client_id) is enforced by uq_sca_one_authoritative_per_signal_client;
-- inserting a second authoritative row for the same pair will error — supersede, do not duplicate.
--
-- Params to bind per run: :client_id, and the (signal_id, attribution_type, basis) set to attribute.
-- attribution_type ∈ {direct, competitor, sector, none}. Positive = direct|competitor|sector.

-- Example: attribute a set of signals as 'direct', superseding any prior authoritative row for the pair.
insert into public.signal_client_attributions
  (signal_id, client_id, attribution_type, is_authoritative, basis, supersedes, disclosure_status, created_by)
select
  cand.signal_id,
  :client_id,
  cand.attribution_type,
  true,                                    -- ALWAYS explicit — never rely on a column default
  cand.basis,
  prior.id,                                -- the authoritative row this supersedes (null if none)
  cand.disclosure_status,
  :created_by
from ( /* :candidates — (signal_id, attribution_type, basis jsonb, disclosure_status) */ ) cand
left join lateral (
  select a.id from public.signal_client_attributions a
  where a.signal_id = cand.signal_id and a.client_id = :client_id and a.is_authoritative = true
  limit 1
) prior on true;
-- NOTE: if prior exists it must be demoted in the SAME logical run — but UPDATE is blocked, so the
-- unique index forces the design: there can be only one authoritative row per pair. The supersede
-- lifecycle (promote new / retire old) is exactly what the promote-on-supersede option (Option 3,
-- deferred) would automate. Until it ships, a re-attribution that changes an existing authoritative
-- verdict must first insert the correction as authoritative for pairs that currently have NONE, and
-- pairs that already have an authoritative row need the deferred trigger or a manual supersede plan.
