-- WO-ENTITY-MENTION-CONTAMINATION — Step 1 (generator fix): STAMP test-provenance on entity_mentions.
--
-- Operator ruling 2026-09-01: STAMP, not drop. A missing row cannot tell a future reader whether
-- nothing was extracted or something was refused (Absence-Is-Not-A-Value). The synthetic fact lives
-- on the row as a local column — which is also the column Step 2's read seam filters on.
--
-- The trigger's job is to make the mention's provenance IDENTIFIABLE, not to decide policy. It never
-- drops or alters which entity/signal is linked. Cross-provenance filtering (test signal -> real
-- entity) is Step 2's read-seam job.
--
-- Chokepoint rationale: the mention write happens at 6 scattered call sites (process-intelligence-
-- document x2, parse-document, process-security-report, extract-predicted-events x2, correlate-
-- entities). They all pass through this ONE table, so the stamp belongs here as a BEFORE INSERT
-- trigger — not at each site (a 7th future writer would miss a per-site fix).

-- ---------------------------------------------------------------------------
-- 1. Column (nullable for the duration of backfill; NOT NULL enforced in step 4).
-- ---------------------------------------------------------------------------
alter table public.entity_mentions add column if not exists is_test boolean;

-- ---------------------------------------------------------------------------
-- 2. Backfill history from the parent's provenance (same derivation as the trigger).
--    signal parent first (100% of current rows); incident parent as fallback (0 rows today).
--    signals.is_test / incidents.is_test default false; a resolved-but-null parent flag is treated
--    as false (unmarked = not test). Unresolvable (no signal AND no incident) is caught by the abort.
-- ---------------------------------------------------------------------------
update public.entity_mentions m
set is_test = coalesce(s.is_test, false)
from public.signals s
where m.signal_id = s.id and m.is_test is null;

update public.entity_mentions m
set is_test = coalesce(i.is_test, false)
from public.incidents i
where m.signal_id is null and m.incident_id = i.id and m.is_test is null;

-- ---------------------------------------------------------------------------
-- 3. FUSED ABORT (same shape as the sweep_category migration). Any of these rolls back the whole
--    migration — no half-stamped column, no silent false on an unresolved row, no accidental delete.
-- ---------------------------------------------------------------------------
do $$
declare
  v_null int; v_total int; v_test int; v_real int;
begin
  select count(*) filter (where is_test is null), count(*),
         count(*) filter (where is_test is true), count(*) filter (where is_test is false)
    into v_null, v_total, v_test, v_real
  from public.entity_mentions;

  -- (a) No row may remain unresolved. An unstamped row = a mention whose parent could not be
  --     resolved (ownerless mention). Do NOT stamp it false — abort and investigate.
  if v_null > 0 then
    raise exception 'ABORT: % entity_mentions rows unresolved (no resolvable signal/incident parent). Ownerless mentions must be investigated, never silently stamped false.', v_null;
  end if;

  -- (b) Row count must be exactly the pre-migration total. This migration stamps; it never deletes.
  if v_total <> 12242 then
    raise exception 'ABORT: entity_mentions total=% but expected 12242. Row count changed — a stamp migration must not add or remove rows.', v_total;
  end if;

  -- (c) The stamped split must match the measured population (2897 test / 9345 real).
  if v_test <> 2897 or v_real <> 9345 then
    raise exception 'ABORT: stamped split test=% real=% but expected 2897/9345. Derivation drifted from the measured population.', v_test, v_real;
  end if;

  raise notice 'entity_mentions is_test backfill OK: total=% test=% real=% (WO-ENTITY-MENTION-CONTAMINATION)', v_total, v_test, v_real;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Enforce NOT NULL + default now that every row carries a value.
-- ---------------------------------------------------------------------------
alter table public.entity_mentions alter column is_test set default false;
alter table public.entity_mentions alter column is_test set not null;

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT trigger: derive is_test from the parent's provenance on every write.
--    Derived value ALWAYS wins (a caller cannot spoof the synthetic-fact stamp).
--    Ownerless mention (no signal AND no incident) is REFUSED, not stamped false
--    (Provenance Doctrine: no ownerless artifacts + Absence-Is-Not-A-Value: scream, don't guess).
-- ---------------------------------------------------------------------------
create or replace function public.tg_entity_mentions_stamp_is_test()
returns trigger language plpgsql as $$
declare
  v_is_test boolean;
begin
  if new.signal_id is not null then
    select s.is_test into v_is_test from public.signals s where s.id = new.signal_id;
    if not found then
      raise exception 'entity_mentions: signal_id % not found — cannot stamp provenance (WO-ENTITY-MENTION-CONTAMINATION)', new.signal_id;
    end if;
  elsif new.incident_id is not null then
    select i.is_test into v_is_test from public.incidents i where i.id = new.incident_id;
    if not found then
      raise exception 'entity_mentions: incident_id % not found — cannot stamp provenance (WO-ENTITY-MENTION-CONTAMINATION)', new.incident_id;
    end if;
  else
    raise exception 'entity_mentions: no signal_id or incident_id — ownerless mention refused (WO-ENTITY-MENTION-CONTAMINATION)';
  end if;

  -- coalesce: a resolved parent whose is_test is NULL is unmarked = not test (both parent tables
  -- default false; 0 such rows exist today). Only an UNRESOLVABLE parent raises (above).
  new.is_test := coalesce(v_is_test, false);
  return new;
end $$;

drop trigger if exists trg_entity_mentions_stamp_is_test on public.entity_mentions;
create trigger trg_entity_mentions_stamp_is_test
  before insert on public.entity_mentions
  for each row execute function public.tg_entity_mentions_stamp_is_test();
