-- Operator Alert Bridge (#69) — TEMPORARY STOPGAP DB objects.
-- State watermark + the pending-alert query RPC + a prod-only cron that drives the digest.
-- SUNSET: drop these + the function when the production recipient model ships.

-- ── single-row watermark state. COMPOSITE (created_at, id) so a LIMIT-capped window can never
--    permanently skip overflow: the watermark advances by (created_at, id) tuple, and the next
--    query resumes strictly after it — no leapfrog, no tie-skip. ──
CREATE TABLE IF NOT EXISTS public.operator_alert_bridge_state (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),  -- exactly one row
  last_notified_created_at  timestamptz NOT NULL DEFAULT now(),
  last_notified_id          uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'
);
ALTER TABLE public.operator_alert_bridge_state ENABLE ROW LEVEL SECURITY;  -- service-role only (no policy)
INSERT INTO public.operator_alert_bridge_state (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ── query: NEW pending alerts for ACTIVE, non-fixture clients. ALL priorities (priority-TAGGED,
--    not filtered) — display sort happens caller-side. ORDER BY (created_at, id) ASC so the
--    LIMITed page is chronological and the composite watermark can resume exactly. The cap-aware
--    resume predicate is a TUPLE comparison: (created_at, id) > (p_since, p_since_id). ──
CREATE OR REPLACE FUNCTION public.operator_bridge_pending_alerts(p_since timestamptz, p_since_id uuid)
RETURNS TABLE (alert_id uuid, created_at timestamptz, recipient text, channel text,
               title text, severity_level text, client_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.created_at, a.recipient, a.channel, i.title, i.severity_level, cl.name
  FROM public.alerts a
  JOIN public.incidents i ON i.id = a.incident_id
  JOIN public.clients   cl ON cl.id = i.client_id
  WHERE a.status = 'pending' AND a.sent_at IS NULL
    AND (a.created_at, a.id) > (p_since, p_since_id)   -- composite resume: no leapfrog, no tie-skip
    AND cl.status = 'active' AND cl.name NOT LIKE '\_%'
  ORDER BY a.created_at ASC, a.id ASC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) TO service_role;

-- ── PRODUCTION-ONLY cron (self-guards to skip on staging; reuses the alert-delivery vault reader
--    for the internal header; fail-closed to 401 if the secret is unset). Staggered off the
--    alert-delivery-v2-email cron (:04/:19/:34/:49) -> bridge at :09/:24/:39/:54. ──
DO $do$
DECLARE v_env text;
BEGIN
  IF to_regclass('public.environment_config') IS NOT NULL THEN
    SELECT environment_name INTO v_env FROM public.environment_config WHERE is_active = true LIMIT 1;
  END IF;
  IF v_env = 'staging' THEN
    RAISE NOTICE 'operator-alert-bridge cron: SKIPPED (environment=staging). PRODUCTION-ONLY.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'operator-alert-bridge-15min') THEN
    PERFORM cron.unschedule('operator-alert-bridge-15min');
  END IF;

  PERFORM cron.schedule('operator-alert-bridge-15min', '9,24,39,54 * * * *', $cron$
    SELECT net.http_post(
      url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/alert-operator-bridge',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-alert-delivery-internal', public.get_alert_delivery_internal_secret()
                 ),
      body    := '{}'::jsonb
    );
  $cron$);
END $do$;
