-- Client Mandate Model (fourth-read ruling 4). Per-client authority taxonomy consumed by the
-- exec-brief action-item / deductions generators (_shared/client-mandate.ts). Subjects are
-- classified OPERATE / AFFILIATED-INFORM / EXTERNAL-MONITOR; each class has a closed action
-- vocabulary. DRAFT profile for PECL — operator reviews/amends before freeze.
alter table public.clients add column if not exists mandate_profile jsonb;

comment on column public.clients.mandate_profile is
  'Authority taxonomy (fourth-read ruling 4): {default_class, classes:{OPERATE|AFFILIATED-INFORM|EXTERNAL-MONITOR:{match:[subject tokens]}}}. Action/deduction generators classify each signal subject and draw only from the class vocabulary (supabase/functions/_shared/client-mandate.ts). Operator-curated fixture.';

-- PECL (Petronas Canada) draft profile. PECL operates upstream (Montney/Peace, Calgary HQ,
-- feeder corridors); the LNG Canada stake belongs to PETRONAS Global (AFFILIATED-INFORM);
-- Ksi Lisims / Uniper / competitors are EXTERNAL-MONITOR. Re-derive the client id by name in
-- each environment (per-project UUIDs never cross projects).
update public.clients
set mandate_profile = jsonb_build_object(
  'version', 'pecl-v1-draft-2026-07-30',
  'default_class', 'EXTERNAL-MONITOR',
  'classes', jsonb_build_object(
    'OPERATE', jsonb_build_object('match', to_jsonb(array[
      'pecl','petronas canada','petronas energy canada','progress energy',
      'montney','north montney','peace region','peace river','fort st. john','fort st john',
      'kakwa','groundbirch','altares','town of',
      'calgary','coastal gaslink corridor','feeder corridor','pecl employee','pecl staff'
    ])),
    'AFFILIATED-INFORM', jsonb_build_object('match', to_jsonb(array[
      'lng canada','kitimat terminal','lng canada phase 2','petronas global stake'
    ])),
    'EXTERNAL-MONITOR', jsonb_build_object('match', to_jsonb(array[
      'ksi lisims','uniper','cedar lng','woodfibre','tilbury','competitor','shell','mitsubishi'
    ]))
  )
)
where name = 'Petronas Canada' and mandate_profile is null;
