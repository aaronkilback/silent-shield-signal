-- WO-ENTITY-EXTRACTION-POLLUTION #4 (operator-approved 2026-08-10): retire the
-- auto-confirm lie. 'confirmed' meant "seen twice by fuzzy substring", not "reviewed".
-- Add an HONEST status value for those historical rows — 'auto_extracted' never
-- implies review. (Applied via MCP; file committed for repo/ledger parity.)
alter table public.entities drop constraint if exists entities_entity_status_check;
alter table public.entities add constraint entities_entity_status_check
  check (entity_status = any (array['suggested'::text,'confirmed'::text,'rejected'::text,'auto_extracted'::text]));

-- Relabel applied (data): 1,211 confirmed+extracted rows -> auto_extracted,
-- excluding 161 rows under legal hold INC-AITOOLS-XTENANT (respected, not forced).
--   update public.entities set entity_status='auto_extracted'
--   where entity_status='confirmed' and visibility_class='extracted'
--     and coalesce(legal_hold,false)=false;
