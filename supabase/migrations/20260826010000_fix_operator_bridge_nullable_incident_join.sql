-- WO-ALERTS-BRIDGE-NULLFK (2026-08-26). The operator-bridge RPC INNER JOINed incidents on the
-- nullable alerts.incident_id (and derived client via the incident), so every incident-less
-- (signal-level) alert was silently dropped — 2 Petronas CVE alerts stuck + the bridge dead since
-- 2026-07-08. Same class as INC-ALERTS-BRIDGE #213/#223. Fix: LEFT JOIN incidents, join clients on
-- the ALERT's own client_id (fallback to the incident's), and fall back the title to the alert's
-- response_json subject when there's no incident.
create or replace function public.operator_bridge_pending_alerts(p_since timestamp with time zone, p_since_id uuid)
 returns table(alert_id uuid, created_at timestamp with time zone, recipient text, channel text, title text, severity_level text, client_name text)
 language sql stable security definer set search_path to ''
as $function$
  select a.id, a.created_at, a.recipient, a.channel,
         coalesce(i.title, a.response_json->>'subject', '(client alert — no incident)') as title,
         coalesce(i.severity_level, upper(nullif(a.response_json->>'priority',''))) as severity_level,
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
