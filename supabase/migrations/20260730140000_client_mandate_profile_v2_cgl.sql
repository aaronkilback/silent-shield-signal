-- Client Mandate Model — PECL profile v2 (operator-approved amendment 2026-07-30).
--
-- Amendment: Coastal GasLink corridor moves OPERATE → AFFILIATED-INFORM. PECL is a SHIPPER on
-- CGL, not the operator — it briefs upward, never tasks security for it. The speculative
-- "feeder corridor" token is dropped (no such asset exists in PECL's pathway geometry; the only
-- corridor is CGL). Horn River / Fort Nelson (Progress-operated) added to OPERATE.
--
-- CRITICAL — TWO SEPARATE AXES: this changes AUTHORITY only. CGL corridor + LNG Canada terminal
-- REMAIN in the relevance/pathway geometry (client_geo_assets) so a hazard near them is still
-- client-relevant and scores normally. Reclassifying authority here does NOT touch geometry.
-- See _shared/client-mandate.ts (relevance vs authority).
--
-- Re-derive the client id by name in each environment (per-project UUIDs never cross projects).
update public.clients
set mandate_profile = jsonb_build_object(
  'version', 'pecl-v2-2026-07-30',
  'note', 'Authority axis only. Relevance/pathway geometry (client_geo_assets) is SEPARATE: CGL corridor + LNG Canada terminal remain in the geometry so a hazard near them is still client-relevant; this profile governs only what ACTION vocabulary the brief may use about a subject.',
  'default_class', 'EXTERNAL-MONITOR',
  'classes', jsonb_build_object(
    'OPERATE', jsonb_build_object('match', to_jsonb(array[
      'pecl','petronas canada','petronas energy canada','progress energy',
      'montney','north montney','peace region','peace river','fort st. john','fort st john',
      'horn river','fort nelson','kakwa','groundbirch','altares','town of',
      'calgary','pecl employee','pecl staff'
    ])),
    'AFFILIATED-INFORM', jsonb_build_object('match', to_jsonb(array[
      'lng canada','kitimat terminal','lng canada phase 2','petronas global stake',
      'coastal gaslink','coastal gaslink corridor','cgl'
    ])),
    'EXTERNAL-MONITOR', jsonb_build_object('match', to_jsonb(array[
      'ksi lisims','uniper','cedar lng','woodfibre','tilbury','competitor','shell','mitsubishi','ngtl'
    ]))
  )
)
where name = 'Petronas Canada';
