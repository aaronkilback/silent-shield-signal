-- WO-FIRE-ESCALATION-PUSH (2026-08-26). Puts a wildfire-risk severity escalation in front of the
-- operator instead of into the un-watched approval queue. NARROW scope: an agent proposes an UPGRADE
-- to high/critical, on a fire-weather signal, for a REAL (non-fixture) client, deduped per client/6h.
-- It writes an incident-less operator-visible alert (tier=interruption, delivery_test_mode=true so it
-- can NEVER reach client delivery) which the fixed operator-bridge emails to the operator. The severity
-- change itself still waits for human approval — this only makes it VISIBLE (no auto-execution on score).
create or replace function public.tg_agent_action_fire_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_proposed text;
  v_evidence text;
begin
  if NEW.action_type <> 'propose_severity_correction' then return NEW; end if;
  if NEW.status <> 'awaiting_approval' then return NEW; end if;

  v_proposed := lower(coalesce(NEW.action_payload->>'proposed_severity',''));
  if v_proposed not in ('high','critical') then return NEW; end if;

  select sig.id, sig.title, sig.normalized_text, sig.severity, sig.category, sig.client_id,
         c.name client_name, c.is_fixture, c.contact_email
    into s
    from signals sig join clients c on c.id = sig.client_id
    where sig.id = NEW.context_signal_id;
  if not found then return NEW; end if;
  if coalesce(s.is_fixture, false) then return NEW; end if;                 -- real clients only
  if severity_rank(v_proposed) <= severity_rank(s.severity) then return NEW; end if;  -- upgrade only

  v_evidence := coalesce(NEW.action_payload->>'evidence', NEW.rationale, '');
  if not (s.category in ('wildfire')
          or v_evidence ~* '(fire weather index|fwi|wildfire|ignition|fire danger)') then
    return NEW;                                                             -- fire-weather only
  end if;

  -- dedup: one fire-escalation per client per 6h window
  if exists (select 1 from alerts a
             where a.client_id = s.client_id and a.tier = 'interruption'
               and (a.response_json->>'kind') = 'fire_weather_escalation'
               and a.created_at > now() - interval '6 hours') then
    return NEW;
  end if;

  insert into alerts (client_id, incident_id, tier, channel, recipient, status, delivery_test_mode, response_json, created_at)
  values (s.client_id, null, 'interruption', 'email',
          coalesce(nullif(s.contact_email, ''), 'operator-review'), 'pending', true,
          jsonb_build_object(
            'kind', 'fire_weather_escalation',
            'priority', 'P1',
            'subject', '[ESCALATION] Wildfire ignition risk — ' || s.client_name || ' — proposed ' || upper(v_proposed),
            'body', 'Agent ' || coalesce(NEW.agent_call_sign, '?') || ' proposes raising "'
                    || left(coalesce(s.title, s.normalized_text), 140) || '" from ' || s.severity || ' to ' || v_proposed
                    || E'.\n\nRationale: ' || v_evidence
                    || E'\n\nProposed severity escalation awaiting approval — review and apply if warranted.',
            'agent_action_id', NEW.id::text,
            'signal_id', s.id::text),
          now());
  return NEW;
exception when others then
  raise warning 'tg_agent_action_fire_escalation failed for action %: %', NEW.id, sqlerrm;
  return NEW;
end $$;

drop trigger if exists trg_agent_action_fire_escalation on public.agent_actions;
create trigger trg_agent_action_fire_escalation
  after insert on public.agent_actions
  for each row execute function public.tg_agent_action_fire_escalation();
