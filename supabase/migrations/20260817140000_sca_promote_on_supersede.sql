-- WO-ATTRIBUTION-SUPERSEDE-TRIGGER-01 — promote-on-supersede + the demotion exemption.
-- The correction path for the append-only + unique-index-strict ledger. Proven 2026-08-17 on an
-- identical-body temp replica: all 8 harness cases pass, INCLUDING the session-spoof case
-- (spoofed GUC + correct-shaped diff issued directly by a session) which is BLOCKED by the
-- pg_trigger_depth() gate — the exemption is a constraint, not a convention.
--
-- Honest limit: pg_trigger_depth() measures DEPTH, not trigger IDENTITY. It guarantees the demotion
-- happened inside a NESTED trigger (which, given this table's trigger set, is the promote trigger);
-- a party with DDL rights could add a colluding trigger to reach depth 2 — a far higher bar than a
-- GUC name, and detectable. Against any SESSION-level SQL it is a real constraint.

-- (1) Append-only guard, amended: DELETE always blocked; UPDATE blocked EXCEPT the promote-trigger's
--     scoped authority demotion, gated by depth>=2 AND the txn-local GUC naming the row AND a pure
--     is_authoritative true->false diff (every other column unchanged).
create or replace function public.tg_sca_append_only()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'signal_client_attributions is append-only; DELETE is never permitted'
      using errcode='check_violation';
  end if;
  if pg_trigger_depth() >= 2
     and current_setting('sca.demoting', true) = old.id::text
     and old.is_authoritative = true and new.is_authoritative = false
     and new.id = old.id and new.signal_id = old.signal_id and new.client_id = old.client_id
     and new.attribution_type = old.attribution_type
     and new.basis is not distinct from old.basis
     and new.supersedes is not distinct from old.supersedes
     and new.disclosure_status is not distinct from old.disclosure_status
     and new.note is not distinct from old.note
     and new.created_by is not distinct from old.created_by
     and new.created_at = old.created_at
  then
    return new;  -- sanctioned demotion (promote-on-supersede path only)
  end if;
  raise exception 'signal_client_attributions is append-only; insert a superseding row instead of % (only the promote-on-supersede trigger may demote)', tg_op
    using errcode='check_violation';
end $fn$;

-- (2) Promote-on-supersede: BEFORE INSERT. When a new authoritative row carries a supersedes ref,
--     validate the target (exists, same pair, currently authoritative) then demote it — so the
--     partial unique index sees exactly one authoritative row for the pair before NEW lands.
create or replace function public.tg_sca_promote_on_supersede()
returns trigger language plpgsql set search_path to 'public' as $fn$
declare v_sig uuid; v_cli uuid; v_auth boolean;
begin
  if new.is_authoritative is true and new.supersedes is not null then
    select signal_id, client_id, is_authoritative into v_sig, v_cli, v_auth
      from public.signal_client_attributions where id = new.supersedes;
    if not found then
      raise exception 'supersede target % not found', new.supersedes using errcode='check_violation'; end if;
    if v_sig <> new.signal_id or v_cli <> new.client_id then
      raise exception 'supersede target % is a different (signal,client) pair', new.supersedes using errcode='check_violation'; end if;
    if v_auth is not true then
      raise exception 'supersede target % is not the current authoritative row', new.supersedes using errcode='check_violation'; end if;
    perform set_config('sca.demoting', new.supersedes::text, true);
    update public.signal_client_attributions set is_authoritative = false where id = new.supersedes;
    perform set_config('sca.demoting', '', true);
  end if;
  return new;
end $fn$;

drop trigger if exists trg_sca_promote_on_supersede on public.signal_client_attributions;
create trigger trg_sca_promote_on_supersede
  before insert on public.signal_client_attributions
  for each row execute function public.tg_sca_promote_on_supersede();

comment on function public.tg_sca_promote_on_supersede() is
  'BEFORE INSERT: demotes the superseded authoritative row (via the depth+GUC+pure-diff exemption in tg_sca_append_only) so a supersede insert atomically promotes new + demotes old without violating append-only or the partial unique index. WO-ATTRIBUTION-SUPERSEDE-TRIGGER-01.';
