-- WO-INCIDENT-QA Step 3: classification backfill for the 16 open survivors ONLY
-- (not the 91 closed by Step 2). PROD-DATA op (applied 2026-07-28 via execute_sql;
-- recorded here for provenance). Idempotent (guards on NULL type / absent rationale).
update incidents i
set incident_type = coalesce(i.incident_type, s.signal_type, s.category, 'other'),
    updated_at = now()
from signals s
where s.id = i.signal_id
  and i.status='open' and i.superseded_by is null and i.deleted_at is null
  and coalesce(i.is_test,false)=false
  and i.incident_type is null;

insert into incident_classification_rationale (incident_id, classification, system_of_origin, rationale, classified_by)
select i.id,
  upper(i.priority::text),
  case
    when s.category in ('cybersecurity','malware','phishing','intrusion','data_exfil','ddos','ransomware','vulnerability','cyber') then 'cyber'
    when s.category in ('wildfire','civil_emergency','natural_disaster','weather','violence','active_threat','physical','sabotage','health_concern','amber_alert','environmental') then 'physical'
    when s.category in ('protest','activism','social_sentiment','extremism','crime') then 'social_media'
    else 'intel_platform'
  end,
  'Backfilled at WO-INCIDENT-QA Step 3. category='||coalesce(s.category,'n/a')||', type='||coalesce(i.incident_type,'n/a')||', priority='||coalesce(i.priority::text,'n/a')||'.',
  'auto'
from incidents i join signals s on s.id = i.signal_id
where i.status='open' and i.superseded_by is null and i.deleted_at is null and coalesce(i.is_test,false)=false
  and not exists (select 1 from incident_classification_rationale r where r.incident_id = i.id);
