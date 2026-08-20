-- WO-CLIENT-ID-AUTOASSIGN-TRIGGER (operator ruling 2026-08-20). Applied to prod via MCP apply_migration
-- (single-file path); committed for git<->ledger parity.
--
-- The auto-assign trigger inferred ownership NON-DETERMINISTICALLY: a client_id-less insert was stamped with
-- the OLDEST ACTIVE client (`clients where status='active' order by created_at asc limit 1`), so the attribution
-- target drifts as the client roster changes — an orphan today goes to PECL, tomorrow to whoever is oldest.
-- Ownership is the one thing in this system that must never be inferred. Drop it; fail closed.
--
-- Blast radius verified BEFORE drop: 0 entities have null client_id (the trigger masked it), so no legitimate
-- client_id-less pattern exists to break; only osint-entity-scan omitted client_id in live code (already
-- disabled, WO-ENTITY-DEDUP writer #2); the only DB inserter approve_entity_suggestion_batch() sets client_id.
--
-- GOVERNANCE NOTE: this trigger was an OUT-OF-BAND prod object (in no committed migration) that did the exact
-- opposite of what the committed #256 Phase-4 migration (20260524040000) was written to enforce ("explicit
-- ownership or skip; never an arbitrary first-row pick"). Logged as a governance finding, not merely a data one.

drop trigger if exists trg_auto_assign_entity_client_id on public.entities;
drop function if exists public.auto_assign_entity_client_id();

-- Fail-closed guard #1 — descriptive error (clearer than a bare NOT NULL violation) for the next omitting writer.
create or replace function public.entities_require_client_id()
returns trigger language plpgsql as $$
begin
  if NEW.client_id is null then
    raise exception 'entities.client_id is required — ownership must be explicit, never inferred. A writer that omits client_id fails closed (WO-CLIENT-ID-AUTOASSIGN-TRIGGER; replaces the non-deterministic oldest-active-client auto-assign).'
      using errcode = 'not_null_violation';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_entities_require_client_id on public.entities;
create trigger trg_entities_require_client_id
  before insert on public.entities
  for each row execute function public.entities_require_client_id();

-- Fail-closed guard #2 — the non-bypassable DB backstop (Provenance Doctrine: a DB constraint is the guarantee
-- service-role writers cannot skip). Safe: 0 existing rows have null client_id.
alter table public.entities alter column client_id set not null;
