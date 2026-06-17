-- Traveller Journey Status v1.1
-- Append-only table of traveller-reported Fortress safety/journey events.
-- Self-scoped (travelers.user_id = auth.uid()). This is NOT airline check-in:
-- no booking refs, passport, seat/baggage, or airline data is stored here.

CREATE TABLE IF NOT EXISTS public.traveller_journey_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traveler_id   uuid NOT NULL REFERENCES public.travelers(id)   ON DELETE CASCADE,
  itinerary_id  uuid NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN ('safe','arrived','at_pickup','in_vehicle','need_assistance')),
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  reported_location text CHECK (reported_location IS NULL OR char_length(reported_location) <= 200),
  reported_country  text CHECK (reported_country IS NULL OR char_length(reported_country) <= 100),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tje_traveler  ON public.traveller_journey_events(traveler_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tje_itinerary ON public.traveller_journey_events(itinerary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tje_client    ON public.traveller_journey_events(client_id);

ALTER TABLE public.traveller_journey_events ENABLE ROW LEVEL SECURITY;

-- Traveller may INSERT only their own events (self-authored AND for a traveler linked to them).
CREATE POLICY tje_traveller_insert_own ON public.traveller_journey_events
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.travelers t WHERE t.id = traveler_id AND t.user_id = auth.uid())
  );

-- Traveller may SELECT only their own events.
-- NOTE: superseded by 20260617143324 (the travelers-RLS-gated EXISTS subquery below made
-- own-select return 0 rows for tenant-less travellers; the follow-up migration replaces this
-- policy with a created_by = auth.uid() predicate).
CREATE POLICY tje_traveller_select_own ON public.traveller_journey_events
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.travelers t WHERE t.id = traveler_id AND t.user_id = auth.uid())
  );

-- Operators (analyst/admin/super_admin) may SELECT events scoped to their accessible clients.
CREATE POLICY tje_operator_select ON public.traveller_journey_events
  FOR SELECT TO authenticated
  USING (
    (is_super_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'analyst'::app_role))
    AND client_id IN (SELECT g.client_id FROM public.get_user_accessible_client_ids(auth.uid()) g)
  );

-- No traveller UPDATE/DELETE policies => append-only (denied by default).
-- service_role bypasses RLS; the traveller-journey-status edge function writes via service role
-- only AFTER verifying caller identity + self-scope ownership. No broad/public policies.

-- Allow the existing travel audit table to record traveller self-actions.
ALTER TABLE public.travel_record_edits DROP CONSTRAINT IF EXISTS tre_source_chk;
ALTER TABLE public.travel_record_edits ADD CONSTRAINT tre_source_chk
  CHECK (source = ANY (ARRAY['manual'::text, 'aegis_proposed'::text, 'traveller_self'::text]));
