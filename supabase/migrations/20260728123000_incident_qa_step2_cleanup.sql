-- WO-INCIDENT-QA Step 2: one-time population cleanup per Phase-1 audit verdicts.
-- PROD-DATA op (applied to prod 2026-07-28 via execute_sql; recorded here for provenance).
-- Soft-close only — nothing deleted, signals retained. Idempotent via the outcome_notes marker.
-- Verdicts: JUNK->invalid · NEWS->news_reclassified (signal retained) · STALE->event_ended.
-- Result: 91 closed (event_ended 35 / news_reclassified 34 / invalid 22), 16 survivors.
with scope as (
  select i.id, i.title, i.incident_type, s.category as sig_cat, s.signal_origin as sig_origin
  from incidents i left join signals s on s.id = i.signal_id
  where i.status = 'open' and i.superseded_by is null and i.deleted_at is null
    and coalesce(i.is_test,false) = false
    and coalesce(i.outcome_notes,'') not like 'WO-INCIDENT-QA Step 2%'   -- idempotency
),
verdict as (
  select id, case
    when upper(substr(id::text,1,8)) = '1ED1341D' then 'invalid'            -- climate-opinion (audited JUNK)
    when upper(substr(id::text,1,8)) = 'E06B10B0' then 'news_reclassified'  -- Larabie family (audited NEWS)
    when incident_type = 'pattern' or title ilike '[PATTERN]%'
         or title = 'Crash Incident' or title ilike 'Critical Other — Petronas%' then 'invalid'
    when incident_type = 'wildfire'
         or sig_cat in ('civil_emergency','wildfire','weather','natural_disaster','health_concern','amber_alert')
         or sig_origin = 'monitor-naad-alerts' then 'event_ended'
    when incident_type in ('cyber','threat','violence','wildlife','operational')
         or sig_cat in ('cybersecurity','malware','crime') then 'news_reclassified'
    else 'SURVIVE'
  end as verdict
  from scope
)
update incidents i
set status = 'closed', closed_at = now(), resolved_at = coalesce(i.resolved_at, now()),
    outcome_recorded_at = now(), outcome_type = v.verdict,
    outcome_notes = 'WO-INCIDENT-QA Step 2 one-time audit cleanup ('||v.verdict||')',
    timeline_json = coalesce(i.timeline_json,'[]'::jsonb) || jsonb_build_object(
      'timestamp', now()::text, 'action','closed', 'reason', v.verdict,
      'note','WO-INCIDENT-QA Step 2 audit cleanup — soft-close, signal retained'),
    updated_at = now()
from verdict v
where i.id = v.id and v.verdict <> 'SURVIVE';

-- Survivors (16): 13 genuine PECL nexus (LNG Canada / Coastal GasLink / Prince Rupert Gas
-- Transmission / Unist'ot'en / BCER-FortisBC regulatory / Stand.earth / LNG social-sentiment),
-- the dark-web exfil hit (E511A205), and ~3 stale global protests (Nantes / Team Canada /
-- Curaçao) that category rules cannot separate from PECL protests — left for Step 4 auto-stale.
