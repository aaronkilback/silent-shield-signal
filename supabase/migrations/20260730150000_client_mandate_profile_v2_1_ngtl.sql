-- Client Mandate Model — PECL profile v2.1 (operator-approved 2026-07-30).
-- NGTL moves EXTERNAL-MONITOR → AFFILIATED-INFORM: same shipper relationship as CGL — PECL's
-- North Montney volumes move on NGTL, so a disruption is direct indirect-impact (briefed upward,
-- never taskable). AUTHORITY axis only; NGTL earns pathway geometry only via a separate named-
-- asset addition with real geometry (not here). Re-derive client id by name per environment.
update public.clients
set mandate_profile = jsonb_set(
  jsonb_set(
    jsonb_set(mandate_profile, '{version}', '"pecl-v2.1-2026-07-30"'),
    '{classes,AFFILIATED-INFORM,match}',
    (mandate_profile->'classes'->'AFFILIATED-INFORM'->'match') || '["ngtl"]'::jsonb
  ),
  '{classes,EXTERNAL-MONITOR,match}',
  (select jsonb_agg(x) from jsonb_array_elements_text(mandate_profile->'classes'->'EXTERNAL-MONITOR'->'match') x where x <> 'ngtl')
)
where name = 'Petronas Canada'
  and not (mandate_profile->'classes'->'AFFILIATED-INFORM'->'match' ? 'ngtl');
