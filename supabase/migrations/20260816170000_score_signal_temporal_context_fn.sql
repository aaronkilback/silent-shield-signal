-- score_signal_temporal_context (form (b), temporal twin of score_signal_hazard_pathway).
-- Factors APPROVED by operator ruling 2026-08-16 (after the saturation question was answered:
-- only 8.5% of BC Place signals sit in the 1.5x clamp zone and those are already ≥main-tier;
-- 61% sit in [0.40,0.60) where 1.5x does non-saturating discriminating work).
--
-- Contract (locked by ruling): mirrors the hazard pathway EXCEPT it NEVER touches
-- signals.relevance_score and NEVER touches the admission gate. A row is written ONLY when a
-- signal date falls inside a client_scheduled_conditions window. No window ⇒ NO row (never a
-- factor of 1). Output lands in signal_temporal_context_scores (RLS-on, deny-by-default).
-- NO CONSUMER is wired — this only populates the shadow store.
--
-- ── APPROVED FACTORS (multiplicative uplift; monotonic with crowd load at this venue) ──
--   full_bowl  (concert)   1.50   ~54k single-night sellout — peak crowd/target density
--   strong     (cfl)       1.35   large draw, regular cadence, rarely a full bowl
--   partial    (mls)       1.20   lower-bowl configuration, moderate draw
--   sustained  (cricket)   1.15   multi-day; persistent but lower PER-DAY density
--   minor      (community) 1.05   not a bowl event; barely above neutral
--   no window              (no row — absence is neutral, never written as 1.0)
--   rivalry modifier: +0.10 when attributes.rivalry=true (Sounders 1.20 → 1.30) — APPROVED.

create or replace function public.score_signal_temporal_context(p_signal_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_sig    record;
  v_cond   record;
  v_factor numeric;
  v_reason text;
begin
  select id, client_id, created_at::date as sig_date
    into v_sig
  from signals where id = p_signal_id;
  if not found then
    return jsonb_build_object('in_window', false, 'reason', 'signal not found');
  end if;

  -- earliest-starting window containing the signal date (deterministic tie-break)
  select c.id, c.condition_type, c.label, c.window_start, c.window_end,
         c.attributes->>'event_class' as event_class,
         c.attributes->>'load_band'  as load_band,
         coalesce((c.attributes->>'rivalry')::boolean, false) as rivalry
    into v_cond
  from client_scheduled_conditions c
  where c.client_id = v_sig.client_id
    and v_sig.sig_date between c.window_start and c.window_end
  order by c.window_start asc, c.window_end asc
  limit 1;

  if v_cond.id is null then
    return jsonb_build_object('in_window', false, 'signal_id', v_sig.id,
      'reason', 'no scheduled condition window contains the signal date');  -- NO WINDOW ⇒ NO ROW
  end if;

  v_factor := case v_cond.load_band
    when 'full_bowl' then 1.50
    when 'strong'    then 1.35
    when 'partial'   then 1.20
    when 'sustained' then 1.15
    when 'minor'     then 1.05
    else 1.00 end;
  if v_cond.rivalry then v_factor := v_factor + 0.10; end if;

  v_reason := format('signal date %s inside %s window [%s..%s] "%s" (class=%s, band=%s%s) -> factor %s',
    v_sig.sig_date, v_cond.condition_type, v_cond.window_start, v_cond.window_end,
    v_cond.label, v_cond.event_class, v_cond.load_band,
    case when v_cond.rivalry then ', rivalry +0.10' else '' end, v_factor);

  insert into public.signal_temporal_context_scores
    (signal_id, client_id, matched_condition_id, condition_type, matched_label,
     in_window, event_class, load_band, factor, window_start, window_end, reasoning)
  values
    (v_sig.id, v_sig.client_id, v_cond.id, v_cond.condition_type, v_cond.label,
     true, v_cond.event_class, v_cond.load_band, v_factor, v_cond.window_start, v_cond.window_end, v_reason);

  -- Intentionally does NOT update signals.relevance_score and does NOT call the admission gate.
  return jsonb_build_object('in_window', true, 'signal_id', v_sig.id, 'matched_label', v_cond.label,
    'event_class', v_cond.event_class, 'load_band', v_cond.load_band, 'factor', v_factor, 'reason', v_reason);
end;
$$;
