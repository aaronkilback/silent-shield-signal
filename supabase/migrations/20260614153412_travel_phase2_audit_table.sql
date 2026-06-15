-- Reconciliation of MCP-applied migration (prod history version 20260614153412).
-- Travel Editing slice — Phase 2: append-only audit substrate for the scoped mutation
-- function (Phase 3) + Aegis propose->approve->commit workflow (Phase 4). Append-only for
-- normal users (no write GRANT, no write policy); reads scoped to accessible clients for
-- analyst/admin, all for super_admin, 0 for viewer/no-tenant; writes/approval only via
-- service_role (the scoped mutation function).
CREATE TABLE IF NOT EXISTS public.travel_record_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  traveler_id uuid,
  itinerary_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  source text NOT NULL,
  approval_status text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,
  request_id text,
  CONSTRAINT tre_table_name_chk CHECK (table_name IN ('itineraries','travelers','itinerary_travelers','travel_alerts','travel_itineraries')),
  CONSTRAINT tre_source_chk CHECK (source IN ('manual','aegis_proposed')),
  CONSTRAINT tre_status_chk CHECK (approval_status IN ('committed','pending','approved','rejected')),
  CONSTRAINT tre_manual_committed_values_chk CHECK (NOT (source='manual' AND approval_status='committed') OR (before_values IS NOT NULL AND after_values IS NOT NULL)),
  CONSTRAINT tre_pending_aegis_chk CHECK (NOT (source='aegis_proposed' AND approval_status='pending') OR (after_values IS NOT NULL AND change_summary IS NOT NULL)),
  CONSTRAINT tre_approved_at_chk CHECK (approval_status <> 'approved' OR approved_at IS NOT NULL),
  CONSTRAINT tre_approved_by_chk CHECK (approval_status <> 'approved' OR approved_by IS NOT NULL),
  CONSTRAINT tre_rejected_reason_chk CHECK (approval_status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tre_client_created_idx ON public.travel_record_edits(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tre_record_idx ON public.travel_record_edits(table_name, record_id);
CREATE INDEX IF NOT EXISTS tre_pending_idx ON public.travel_record_edits(approval_status) WHERE approval_status='pending';
ALTER TABLE public.travel_record_edits ENABLE ROW LEVEL SECURITY;
-- Defense-in-depth: strip default-privilege writes; normal users get read-only.
REVOKE ALL ON public.travel_record_edits FROM authenticated, anon, public;
GRANT SELECT ON public.travel_record_edits TO authenticated;
GRANT ALL ON public.travel_record_edits TO service_role;
DROP POLICY IF EXISTS travel_record_edits_select_scoped ON public.travel_record_edits;
CREATE POLICY travel_record_edits_select_scoped ON public.travel_record_edits FOR SELECT TO authenticated
 USING (is_super_admin(auth.uid()) OR ((has_role(auth.uid(),'analyst'::app_role) OR has_role(auth.uid(),'admin'::app_role)) AND client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
DROP POLICY IF EXISTS travel_record_edits_service_all ON public.travel_record_edits;
CREATE POLICY travel_record_edits_service_all ON public.travel_record_edits FOR ALL TO service_role USING (true) WITH CHECK (true);
