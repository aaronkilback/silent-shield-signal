-- Client protection-class, so gate policy can differ by client type.
--
-- WHY: the relevance floor (0.6) and the WILDFIRE operational-criticality test were tuned on the
-- CORPORATE / sector-proximity cyber case. Applied uniformly they gut a personal/family-safety
-- client's feed — including an evacuation ORDER 4.3 km from a protected school, which scores below
-- the cyber-tuned floor. Personal-safety clients need proximity-based, life-safety-first thresholds,
-- not the sector-noise floor. There was no field to branch on (only `industry`, empty for Kilbacks),
-- so the gates could not distinguish client classes at all.
--
-- Default 'corporate' preserves current behavior for every existing client; only explicitly
-- reclassified clients change policy. Kilbacks -> personal_safety.

alter table public.clients
  add column if not exists client_class text not null default 'corporate';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_client_class_check') then
    alter table public.clients
      add constraint clients_client_class_check
      check (client_class in ('corporate','personal_safety','venue'));
  end if;
end $$;

update public.clients
   set client_class = 'personal_safety'
 where id = 'd3b200b5-1f85-453e-bdba-f2b7b463f308';  -- Kilbacks (family/personal safety)
