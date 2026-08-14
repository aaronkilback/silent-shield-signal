-- WO-SILENT-ZERO-PROBE — Variant A (regression) AUDIT-ONLY detector.
-- Reports EVERY monitor with one of: healthy | regression | insufficient_history |
-- precision_feed_exempt | unverified_exemption | unevaluable. Never silently passes.
--
-- Data sources: signals (terminal yield by origin, NOT result_summary.signals_created — see
-- WO-COVERAGE Case #2), cron.job_run_details + monitor_run_ledger (runs, both caller paths),
-- monitor_precision_declaration (evidence-bound exemptions).
--
-- State precedence:
--   unevaluable            — origin is (unset); attribution gap (P2), cannot yield-check
--   healthy                — recent_signals(7d) > 0
--   precision_feed_exempt  — recent=0, VALID declaration (is_precision_feed + expected_yield + basis + review_by>=today)
--   unverified_exemption   — recent=0, declaration present but INVALID (missing field / expired) → re-verify
--   insufficient_history   — recent=0, and Variant A cannot judge:
--                              short_span (<30d run history — baseline not establishable)
--                              baseline_but_<3_recent_runs (not confirmably running)
--                              never_produced (0 signals over lifetime despite N runs → Variant B target)
--   regression             — recent=0, baseline(7-90d)>0, ran >=3 times in last 7d
--
-- NOTE: origin→monitor mapping is explicit (attribution is irregular; P2). Re-run after seeding
-- declarations or new monitors. This becomes the scheduled probe once audit output is triaged.
with decl as (
  select monitor, is_precision_feed, expected_yield, basis, review_by,
    (is_precision_feed and coalesce(length(trim(expected_yield)),0)>0
     and coalesce(length(trim(basis)),0)>0 and review_by is not null and review_by >= current_date) as decl_valid,
    case when not is_precision_feed then 'is_precision_feed=false'
      when coalesce(length(trim(expected_yield)),0)=0 then 'missing expected_yield'
      when coalesce(length(trim(basis)),0)=0 then 'missing basis'
      when review_by is null then 'missing review_by'
      when review_by < current_date then 'review_by expired '||review_by::text
      else 'valid' end as decl_reason
  from public.monitor_precision_declaration
),
mon(monitor, origin_pat) as (values
  ('monitor-instagram','%instagram%'),('monitor-csis','%csis%'),('monitor-darkweb','%darkweb%'),
  ('monitor-cisa-kev','%cisa%'),('monitor-weather','%weather%'),('monitor-earthquakes','%earthquake%'),
  ('monitor-domains','%domain%'),('monitor-linkedin','%linkedin%'),('monitor-social','monitor-social'),
  ('monitor-court-registry','%court%'),('monitor-community-outreach','%energetic%'),
  ('monitor-canadian-sources','%canadian%'),('monitor-github','%github%'),('monitor-naad-alerts','%naad%'),
  ('monitor-pastebin','%pastebin%'),('monitor-rss-sources','__unattributed__')
),
sig as (
  select coalesce(raw_json->>'signal_origin',raw_json->>'monitor_name',raw_json->>'source','') as origin,
    count(*) filter (where created_at>now()-interval '7 days') as recent,
    count(*) filter (where created_at<=now()-interval '7 days') as baseline
  from signals where created_at > now()-interval '90 days' group by 1
),
sig_per_mon as (
  select m.monitor, coalesce(sum(sig.recent),0) as recent_signals, coalesce(sum(sig.baseline),0) as baseline_signals
  from mon m left join sig on m.origin_pat<>'__unattributed__' and sig.origin ilike m.origin_pat
  group by m.monitor
),
cron_agg as (
  select substring(command from 'functions/v1/(monitor-[a-z-]+)') as monitor,
    count(*) filter (where start_time>now()-interval '7 days') as rr, count(*) as lr, min(start_time) as earliest
  from cron.job_run_details where command ~ 'functions/v1/monitor-' group by 1
),
ledger_agg as (
  select monitor, count(*) filter (where started_at>now()-interval '7 days') as rr, count(*) as lr, min(started_at) as earliest
  from monitor_run_ledger group by 1
),
metrics as (
  select m.monitor, m.origin_pat, sp.recent_signals, sp.baseline_signals,
    coalesce(c.rr,0)+coalesce(l.rr,0) as recent_runs,
    coalesce(c.lr,0)+coalesce(l.lr,0) as lifetime_runs,
    least(c.earliest,l.earliest) as earliest_run
  from mon m left join sig_per_mon sp on sp.monitor=m.monitor
    left join cron_agg c on c.monitor=m.monitor left join ledger_agg l on l.monitor=m.monitor
)
select me.monitor, me.recent_signals rs, me.baseline_signals bs, me.recent_runs rr, me.lifetime_runs lr,
  case when me.earliest_run is null then null else extract(day from now()-me.earliest_run)::int end span_d,
  case when me.origin_pat='__unattributed__' then 'unevaluable'
    when me.recent_signals>0 then 'healthy'
    when d.monitor is not null and d.decl_valid then 'precision_feed_exempt'
    when d.monitor is not null and not d.decl_valid then 'unverified_exemption'
    when me.earliest_run is null then 'insufficient_history'
    when extract(day from now()-me.earliest_run)<30 then 'insufficient_history'
    when me.baseline_signals>0 and me.recent_runs>=3 then 'regression'
    else 'insufficient_history' end state,
  case when me.origin_pat='__unattributed__' then 'origin=(unset) attribution gap P2'
    when me.recent_signals>0 then 'producing'
    when d.monitor is not null and d.decl_valid then 'valid_declaration'
    when d.monitor is not null and not d.decl_valid then d.decl_reason
    when me.earliest_run is null then 'no_run_history'
    when extract(day from now()-me.earliest_run)<30 then 'short_span_'||extract(day from now()-me.earliest_run)::int||'d'
    when me.baseline_signals>0 and me.recent_runs>=3 then 'was_producing_now_0'
    when me.baseline_signals>0 then 'baseline_but_<3_recent_runs'
    else 'never_produced_in_'||me.lifetime_runs||'_runs_VarB' end reason,
  d.review_by
from metrics me left join decl d on d.monitor=me.monitor
order by state, me.monitor;
