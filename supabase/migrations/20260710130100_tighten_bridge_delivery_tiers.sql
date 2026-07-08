-- #76 (C-1) — the #69 operator-alert-bridge must digest only DELIVERY-tier undelivered alerts.
-- Once writers set tier (C-1), log/finding rows must NOT flood the operator digest — the bridge is a
-- client-RISK backstop, and log=awareness / finding=operator-pull are not client-risk-urgent. Same
-- doctrine as the claim gate. This also drops the legacy log-tier pending rows from the digest.
CREATE OR REPLACE FUNCTION public.operator_bridge_pending_alerts(p_since timestamptz, p_since_id uuid)
RETURNS TABLE (alert_id uuid, created_at timestamptz, recipient text, channel text,
               title text, severity_level text, client_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.created_at, a.recipient, a.channel, i.title, i.severity_level, cl.name
  FROM public.alerts a
  JOIN public.incidents i ON i.id = a.incident_id
  JOIN public.clients   cl ON cl.id = i.client_id
  WHERE a.status = 'pending' AND a.sent_at IS NULL
    AND a.tier IN ('notification', 'interruption')   -- delivery-tier only (C-1); excludes log/finding
    AND (a.created_at, a.id) > (p_since, p_since_id)
    AND cl.status = 'active' AND cl.name NOT LIKE '\_%'
  ORDER BY a.created_at ASC, a.id ASC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) TO service_role;
