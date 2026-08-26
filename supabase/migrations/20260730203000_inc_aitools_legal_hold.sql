-- INC-AITOOLS-XTENANT-2026-07-30 LEGAL HOLD: freeze the breach-implicated PECL personal records
-- (788 person entities + their entity_photos + 2 investigations) pending legal review.
-- No modification, deletion, or reclassification permitted on held rows.
-- Applied to prod via single-file apply_migration 2026-07-30 (no db push; ledger prohibition).

alter table public.entities        add column if not exists legal_hold boolean not null default false;
alter table public.entity_photos   add column if not exists legal_hold boolean not null default false;
alter table public.investigations  add column if not exists legal_hold boolean not null default false;

-- Mark held set. Entities quiesced (active_monitoring_enabled=false) FIRST so live monitors skip them
-- and never hit the freeze. This UPDATE runs before the trigger exists, so it is permitted.
update public.entities
  set legal_hold = true, active_monitoring_enabled = false
  where client_id = '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d' and type = 'person' and created_at < '2026-06-12';

update public.entity_photos
  set legal_hold = true
  where entity_id in (
    select id from public.entities
    where client_id = '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d' and type = 'person' and created_at < '2026-06-12');

update public.investigations
  set legal_hold = true
  where client_id = '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d' and created_at < '2026-06-12';

create or replace function public.block_legal_hold_writes()
returns trigger language plpgsql as $function$
begin
  if TG_OP = 'DELETE' then
    if OLD.legal_hold then
      raise exception 'LEGAL HOLD (INC-AITOOLS-XTENANT-2026-07-30): row % frozen pending legal review; DELETE blocked', OLD.id;
    end if;
    return OLD;
  end if;
  if OLD.legal_hold then
    raise exception 'LEGAL HOLD (INC-AITOOLS-XTENANT-2026-07-30): row % frozen pending legal review; modification/reclassification blocked', OLD.id;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_legal_hold_entities on public.entities;
drop trigger if exists trg_legal_hold_entity_photos on public.entity_photos;
drop trigger if exists trg_legal_hold_investigations on public.investigations;
create trigger trg_legal_hold_entities before update or delete on public.entities
  for each row execute function public.block_legal_hold_writes();
create trigger trg_legal_hold_entity_photos before update or delete on public.entity_photos
  for each row execute function public.block_legal_hold_writes();
create trigger trg_legal_hold_investigations before update or delete on public.investigations
  for each row execute function public.block_legal_hold_writes();

-- Release (when legal review clears): drop the three trg_legal_hold_* triggers, then
-- `update ... set legal_hold=false` on the held rows. The freeze is fully reversible.
