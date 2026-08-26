-- WO-ALERTS-BRIDGE-NULLFK follow-up (2026-08-26): the 2 delivered Petronas alerts rendered "P?"
-- because their priority lives in the body ("Priority: P1") / subject ("[HIGH]"), not a top-level
-- response_json.priority key. Extend the severity fallback chain so legacy AI-decision-engine alerts
-- resolve their priority too. Escalation alerts (top-level priority) and incident alerts already resolved.
create or replace function public.operator_bridge_pending_alerts(p_since timestamp with time zone, p_since_id uuid)
 returns table(alert_id uuid, created_at timestamp with time zone, recipient text, channel text, title text, severity_level text, client_name text)
 language sql stable security definer set search_path to ''
as $function$
  select a.id, a.created_at, a.recipient, a.channel,
         coalesce(i.title, a.response_json->>'subject', '(client alert — no incident)') as title,
         coalesce(
           i.severity_level,
           upper(nullif(a.response_json->>'priority','')),
           substring(a.response_json->>'body' from 'Priority:\s*(P[1-3])'),
           case upper(substring(a.response_json->>'subject' from '\[(HIGH|CRITICAL|MEDIUM|LOW)\]'))
             when 'CRITICAL' then 'P1' when 'HIGH' then 'P1' when 'MEDIUM' then 'P2' when 'LOW' then 'P3' end
         ) as severity_level,
         cl.name
  from public.alerts a
  left join public.incidents i on i.id = a.incident_id
  join public.clients cl on cl.id = coalesce(a.client_id, i.client_id)
  where a.status = 'pending' and a.sent_at is null
    and a.tier in ('notification', 'interruption')
    and (a.created_at, a.id) > (p_since, p_since_id)
    and cl.status = 'active' and cl.name not like '\_%'
  order by a.created_at asc, a.id asc
  limit 100;
$function$;
