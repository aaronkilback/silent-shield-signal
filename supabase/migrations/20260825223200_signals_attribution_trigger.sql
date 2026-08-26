-- WO-ATTRIBUTION-PERSIST-02 (2026-08-25) — component 3 of 3: the ONE writer.
-- Centralized (operator ruling: "one shared post-insert step so every ingest path is covered;
-- per-path wiring is how the KEV guardrail and the check2 detector both ended up half-blind").
-- An AFTER INSERT trigger on signals fires on EVERY ingest path automatically — a path cannot
-- bypass it. It reads raw_json.matched_keywords (set by the deterministic matcher at ingest) and
-- persists the attribution verdict into signal_client_attributions.
--
-- Verdict rules (per the ledger's own column definitions, 20260810180000):
--   direct     = a name/keyword/asset hit for a STANDARD client
--   competitor = competitor_names hit
--   sector     = tier-2 / industry-anchor fuzzy match
--   none       = provisional for a VENUE client name-only match, pending the nexus gate
--   (empty matched_keywords => CAN'T-CLASSIFY => skip; NEVER fall through to a verdict)
--
-- Venue clients: a name match is NOT sufficient for 'direct' (routine event/sports/business
-- coverage names the venue too). Born provisional 'none' + enqueue attribution-nexus-gate, which
-- promotes to 'direct' only on a confirmed security nexus (deterministic lexicon else LLM
-- tiebreaker; unavailable => stays none). Complex/tunable logic stays in the edge function.
--
-- Quarantined signals (fabricated_client_match_auto) get NO attribution — the born-quarantine gate
-- already excluded them; a positive attribution for a fabricated match would be a false client nexus.
create or replace function public.tg_signals_attribution_persist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mk         jsonb;
  v_nkw        int;
  v_has_strong boolean;
  v_has_comp   boolean;
  v_all_tier2  boolean;
  v_profile    text;
  v_attr_type  text;
  v_prov_id    uuid;
begin
  -- Only client-owned, non-quarantined signals are attributable.
  if NEW.client_id is null then return NEW; end if;
  if NEW.quality_status = 'quarantined' then return NEW; end if;

  v_mk := coalesce(NEW.raw_json -> 'matched_keywords', '[]'::jsonb);
  if jsonb_typeof(v_mk) <> 'array' then return NEW; end if;
  v_nkw := jsonb_array_length(v_mk);
  if v_nkw = 0 then return NEW; end if;   -- can't-classify => skip

  select bool_or(k not like 'tier2:%' and k not like 'competitor:%'),
         bool_or(k like 'competitor:%'),
         bool_and(k like 'tier2:%')
    into v_has_strong, v_has_comp, v_all_tier2
    from jsonb_array_elements_text(v_mk) as k;

  select attribution_profile into v_profile from public.clients where id = NEW.client_id;

  -- ── Venue client with a name/keyword match: provisional none + enqueue nexus gate ──
  if v_profile = 'venue' and coalesce(v_has_strong, false) then
    insert into public.signal_client_attributions
      (signal_id, client_id, attribution_type, is_authoritative, supersedes, basis, created_by)
    values (NEW.id, NEW.client_id, 'none', true, null,
      jsonb_build_object(
        'basis_label', 'venue_pending_nexus',
        'kind', 'venue_name_only_pending',
        'all_matched_keywords', v_mk,
        'matcher_version', 'ingest-trigger WO-ATTRIBUTION-PERSIST-02 2026-08-25',
        'actor', 'system:tg_signals_attribution_persist',
        'born_at_ingest', true),
      null)
    returning id into v_prov_id;

    insert into public.function_jobs (job_type, payload, status, max_attempts, scheduled_for, idempotency_key)
    values ('attribution-nexus-gate',
            jsonb_build_object('signal_id', NEW.id, 'client_id', NEW.client_id, 'provisional_attribution_id', v_prov_id),
            'pending', 3, now(),
            'attribution-nexus-gate:' || NEW.id::text || ':' || NEW.client_id::text)
    on conflict do nothing;

    return NEW;
  end if;

  -- ── Standard client: deterministic verdict ──
  v_attr_type := case
                   when coalesce(v_has_strong, false) then 'direct'
                   when coalesce(v_all_tier2, false)  then 'sector'
                   when coalesce(v_has_comp, false)   then 'competitor'
                   else null   -- nkw>0 but nothing classifiable: skip defensively
                 end;
  if v_attr_type is null then return NEW; end if;

  insert into public.signal_client_attributions
    (signal_id, client_id, attribution_type, is_authoritative, supersedes, basis, created_by)
  values (NEW.id, NEW.client_id, v_attr_type, true, null,
    jsonb_build_object(
      'basis_label', case when v_attr_type = 'sector' then 'tier2_industry_anchor'
                          when v_attr_type = 'competitor' then 'competitor'
                          else 'keyword' end,
      'all_matched_keywords', v_mk,
      'keyword_fired', v_mk ->> 0,
      'matcher_version', 'ingest-trigger WO-ATTRIBUTION-PERSIST-02 2026-08-25',
      'actor', 'system:tg_signals_attribution_persist',
      'born_at_ingest', true),
    null);

  return NEW;
exception when others then
  -- A ledger miss must NEVER fail the signal insert (the signal is the load-bearing artifact).
  raise warning 'tg_signals_attribution_persist failed for signal %: %', NEW.id, sqlerrm;
  return NEW;
end $$;

drop trigger if exists trg_signals_attribution_persist on public.signals;
create trigger trg_signals_attribution_persist
  after insert on public.signals
  for each row execute function public.tg_signals_attribution_persist();
