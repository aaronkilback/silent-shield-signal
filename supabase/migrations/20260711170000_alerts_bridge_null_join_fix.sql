-- ============================================================
--  Fix: operator_bridge_pending_alerts INNER-JOIN NULL-context defect
--
--  BEFORE (20260710130100_tighten_bridge_delivery_tiers, prod-effective):
--    JOIN incidents i ON i.id = a.incident_id
--    JOIN clients cl ON cl.id = i.client_id
--    → NULL-incident_id alerts + orphan-incident alerts silently
--      dropped during join execution.
--
--  Confirmed 2026-07-11 during INC-ALERTS-BRIDGE forensic (Task #223):
--  13,612 alerts are orphaned by this pattern at prod scale. Same
--  defect class as auto_approve #213 (PR #147) at 13x scale. One
--  trapped row was a tier='interruption' critical NAAD Amber Alert
--  (2026-07-10) — benign ONLY because it routed to _benchmark_bcch
--  fixture. Had it routed to BC Place (FIFA venue, CRT eval), it
--  would have been a real undelivered public-safety interruption.
--
--  AFTER: LEFT JOIN + explicit `i.id IS NOT NULL` and `cl.id IS NOT NULL`
--  guards. Behavior is semantically identical (still only deliver
--  alerts we can address) but the drop is VISIBLE at the filter step
--  rather than hidden inside join execution — a debug query can
--  count how many orphans are being excluded, and the CI guard for
--  the INNER-JOIN-on-nullable-FK class (next PR) can apply
--  uniformly to the codebase.
--
--  IMPORTANT — the 2026-07-10 NAAD Amber Alert did NOT fail at JOIN
--  execution. Forensic 2026-07-11 initially framed it as "trapped by
--  the bridge JOIN"; that framing was incorrect and the operator
--  called the correction. The Amber Alert:
--    - had a valid incident_id pointing at a live `_benchmark_bcch`
--      incident (JOIN would have succeeded);
--    - was correctly filtered by fixture-name predicate
--      (`cl.name NOT LIKE '\_%'`) — working as designed;
--    - failed at RECIPIENT ROUTING at generation time (recipient
--      stored literally as 'unrouted:no-verified-recipient' because
--      the client_alert_recipients lookup returned no verified row).
--
--  So this migration provides JOIN-topology parity with the doctrine
--  (LEFT JOIN + IS NOT NULL, matching #213 and setting the CI-guard
--  pattern) — but it is NOT what would have caught the Amber Alert.
--
--  The load-bearing catch for the Amber Alert's failure mode is the
--  companion watchdog P1.4-PAGEABLE probe (system-watchdog code
--  change in the same PR): any tier IN ('interruption','notification')
--  alert undispatched past its window OR carrying an 'unrouted:*'
--  placeholder recipient fires CRITICAL, regardless of JOIN topology.
--
--  Future readers: the JOIN fix and the probe address DIFFERENT
--  failure modes that surfaced together during INC-ALERTS-BRIDGE.
--  The JOIN fix hardens the class doctrinally. The probe is the
--  live catch. Both belong in one PR because they close the class
--  together (close the leak + make the class scream).
--
--  Ratified by operator 2026-07-11 (INC-ALERTS-BRIDGE remediation
--  step 1 of 4). Doctrine: feedback_inner_join_nullable_fk_doctrine.md.
--  Enforcement token in the RPC return (as a companion telemetry
--  field so drift is grep-able):
--    INC_ALERTS_BRIDGE_NULL_JOIN_FIX_2026_07_11
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_bridge_pending_alerts(p_since timestamptz, p_since_id uuid)
RETURNS TABLE (alert_id uuid, created_at timestamptz, recipient text, channel text,
               title text, severity_level text, client_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.created_at, a.recipient, a.channel, i.title, i.severity_level, cl.name
  FROM public.alerts a
  LEFT JOIN public.incidents i ON i.id = a.incident_id
  LEFT JOIN public.clients cl ON cl.id = i.client_id
  WHERE a.status = 'pending' AND a.sent_at IS NULL
    AND a.tier IN ('notification', 'interruption')   -- delivery-tier only (C-1); excludes log/finding
    AND i.id IS NOT NULL                              -- doctrinal guard: NULL-FK class
    AND cl.id IS NOT NULL                             -- doctrinal guard: orphan-incident class
    AND (a.created_at, a.id) > (p_since, p_since_id)
    AND cl.status = 'active' AND cl.name NOT LIKE '\_%'
  ORDER BY a.created_at ASC, a.id ASC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) TO service_role;

COMMENT ON FUNCTION public.operator_bridge_pending_alerts(timestamptz, uuid) IS
  'INC_ALERTS_BRIDGE_NULL_JOIN_FIX_2026_07_11 — LEFT JOIN + IS NOT NULL guards ratified 2026-07-11. See feedback_inner_join_nullable_fk_doctrine.md.';
