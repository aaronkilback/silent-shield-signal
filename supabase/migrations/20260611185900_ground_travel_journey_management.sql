-- Ground Travel / Journey Management (Phase A). L1C: client-scoped passenger join
-- + journey-plan fields on itineraries (additive, nullable => flights unaffected).
-- (Applied to prod via MCP; this file keeps the repo in sync. Idempotent.)

-- 1) Passenger join (multiple travelers per ground journey / itinerary)
CREATE TABLE IF NOT EXISTS public.itinerary_travelers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id uuid NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
  traveler_id uuid NOT NULL REFERENCES public.travelers(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'passenger',
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (itinerary_id, traveler_id)
);
CREATE INDEX IF NOT EXISTS idx_itinerary_travelers_itinerary ON public.itinerary_travelers(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_travelers_client ON public.itinerary_travelers(client_id);

ALTER TABLE public.itinerary_travelers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY itinerary_travelers_tenant_select ON public.itinerary_travelers
    FOR SELECT TO public USING (client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
  CREATE POLICY itinerary_travelers_tenant_insert ON public.itinerary_travelers
    FOR INSERT TO public WITH CHECK (client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
  CREATE POLICY itinerary_travelers_tenant_update ON public.itinerary_travelers
    FOR UPDATE TO public USING (client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
    WITH CHECK (client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
  CREATE POLICY itinerary_travelers_tenant_delete ON public.itinerary_travelers
    FOR DELETE TO public USING (client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
  CREATE POLICY super_admin_bypass_itinerary_travelers ON public.itinerary_travelers
    FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Journey-management fields on itineraries
ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS journey_plan jsonb,
  ADD COLUMN IF NOT EXISTS check_in_interval_minutes integer,
  ADD COLUMN IF NOT EXISTS last_check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_check_in_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS journey_overdue boolean NOT NULL DEFAULT false;

-- 3) Partial index for the overdue monitor (ground journeys awaiting check-in)
CREATE INDEX IF NOT EXISTS idx_itineraries_ground_checkin
  ON public.itineraries(next_check_in_due_at)
  WHERE trip_type = 'ground' AND next_check_in_due_at IS NOT NULL;
