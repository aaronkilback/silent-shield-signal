-- Entity merge / soft-delete substrate (WO-ENTITY-DEDUP). Applied to prod via MCP apply_migration
-- 2026-08-20 (single-file path per Migration-Apply Prohibition; file committed for git↔ledger parity).
--
-- Merge = consolidate to the entity-with-data + reparent every reference + mark the loser merged_into
-- (NEVER delete). Soft-delete = deleted_at + reason (for cross-client cruft that should not be merged,
-- e.g. the operator's personal entity mis-attached to a client). find-or-create writers skip merged/deleted
-- rows so a re-run reuses the survivor, not a tombstone.
alter table public.entities add column if not exists merged_into uuid;
alter table public.entities add column if not exists merged_at timestamptz;
alter table public.entities add column if not exists merge_reason text;
alter table public.entities add column if not exists deleted_at timestamptz;
alter table public.entities add column if not exists deleted_reason text;
create index if not exists entities_merged_into_idx on public.entities (merged_into) where merged_into is not null;

-- Drop PHANTOM trace tables. aegis_tool_calls / aegis_invocations are never written by anything and
-- mimic the REAL tracing system (aegis_request_trace / aegis_prompt_trace / aegis_retrieval_trace /
-- aegis_tool_trace / aegis_grounding_trace, written by _shared/flight-recorder.ts). They cost an hour of
-- misdiagnosis (looked empty => "tracing not wired", when the real tables were populated). Remove the trap.
drop table if exists public.aegis_tool_calls cascade;
drop table if exists public.aegis_invocations cascade;
