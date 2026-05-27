-- INC-LEARN-CONTAM (2026-05-27) — P0 WRITE FREEZE on contaminated shared-learning stores.
--
-- The L2 content-provenance audit (docs/platform-operations/audits/aegis-l2-content-
-- provenance-audit-2026-05-27.md) proved that expert_knowledge, global_learning_insights,
-- and agent_beliefs are contaminated with tenant-identifying facts:
--   • uploaded tenant PDFs ingested into expert_knowledge (e.g. "Petronas - Security
--     Awareness Report - Apr 17 2026.pdf") via process-stored-document / process-security-report
--   • AI beliefs synthesised from one tenant's signals stored client-null in agent_beliefs
--     ("Petronas faces … reputational risk … LNG Canada Phase 2") via knowledge-synthesizer / system-ops
--   • cross-tenant aggregates + world-expertise written into global_learning_insights via
--     aggregate-global-learnings / ingest-world-knowledge / submit_learning_insight
-- Measured blast radius: global_learning_insights 284/1459 (19.5%); expert_knowledge ≥137;
-- agent_beliefs ≥83 (lower bounds).
--
-- Aegis READ paths are already contained (dashboard-ai-assistant default-deny). This freezes
-- the WRITE paths so contamination cannot grow while remediation (anonymisation gate +
-- re-derivation) is designed. It is the NON-BYPASSABLE backstop: service-role writers bypass
-- RLS but NOT triggers, and these ~9 writer functions all run service-role.
--
-- Mechanism: BEFORE INSERT trigger returns NULL → the row insert is silently skipped (0 rows,
-- no error), so the autonomous writer functions no-op cleanly without erroring or retrying.
-- Scope: INSERT only. Existing rows remain; UPDATEs (e.g. belief confidence evolution) are
-- unaffected. Fully reversible — DROP the three triggers to restore writes.
--
-- DO NOT remove until INC-LEARN-CONTAM remediation lands an anonymisation/identity gate that
-- runs BEFORE any write to a shared-learning store.

create or replace function public.inc_learn_contam_write_freeze()
returns trigger
language plpgsql
as $$
begin
  -- Contamination containment (INC-LEARN-CONTAM): cancel the insert. Returning NULL
  -- from a BEFORE INSERT row trigger skips the row without raising an exception, so
  -- callers observe 0 rows inserted and no error.
  return null;
end;
$$;

create trigger trg_inc_learn_contam_freeze_ek
  before insert on public.expert_knowledge
  for each row execute function public.inc_learn_contam_write_freeze();

create trigger trg_inc_learn_contam_freeze_gli
  before insert on public.global_learning_insights
  for each row execute function public.inc_learn_contam_write_freeze();

create trigger trg_inc_learn_contam_freeze_ab
  before insert on public.agent_beliefs
  for each row execute function public.inc_learn_contam_write_freeze();
