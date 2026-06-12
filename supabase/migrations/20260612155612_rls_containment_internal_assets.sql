-- RLS Containment — internal_assets (applied to prod, version 20260612155612).
-- Highest remaining risk: 8 live SENSITIVE rows (SCADA/PLC/firewall/VPN/ERP/OT infra) with broad read.
-- Diagnosis: all 8 rows NULL client_id + NULL created_by + same-day seed (2026-03-05) + empty metadata =
-- unassigned ownership debt. Names suggestive of Petronas (LNG/Melaka/KL) but NOT ownership evidence;
-- NOT backfilled (do-not-guess). Too sensitive to be a sanctioned global reference.
-- Decision: SET-C client-owned scope. NULL rows fail closed -> super_admin + service_role only.
-- Future client-stamped assets visible to that client's members. No prod UI reads this table
-- (only e2e tests + service_role edge fns: dashboard-ai-assistant, query-internal-context, threat-radar-analysis).
-- Existing role-gated insert/update/delete preserved. service_role bypasses RLS (preserved).
-- Verified (real identities): A (SSO analyst)=0, no-tenant traveller=0, B (CRT analyst)=0, super_admin=8,
-- no-role INSERT blocked, 0 residual broad policy. Synthetic two-tenant: own-client visible, foreign->0, NULL->0.
DROP POLICY IF EXISTS "Authenticated users can view internal assets" ON public.internal_assets;
CREATE POLICY "ia_sel" ON public.internal_assets FOR SELECT TO authenticated USING (
  is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
