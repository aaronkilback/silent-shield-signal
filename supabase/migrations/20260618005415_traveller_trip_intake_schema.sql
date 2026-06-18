-- Traveller Trip Intake (Slice A) — pending, NON-OPERATIONAL, review-gated intake layer.
-- Aegis collects → traveller confirms → operator approves → Fortress monitors. These tables
-- are NOT operational: nothing here is monitored. Only a later operator-approval workflow may
-- create/update an operational itinerary (via linked_itinerary_id). Traveller writes happen
-- ONLY through a self-scoped service-role function (Slice B); Slice A grants travellers
-- SELECT-own + operators scoped SELECT, and NO direct traveller write policies.

CREATE TABLE IF NOT EXISTS public.traveller_trip_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traveler_id         uuid NOT NULL REFERENCES public.travelers(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES public.clients(id)   ON DELETE CASCADE,
  created_by          uuid NOT NULL,
  trip_name           text CHECK (trip_name IS NULL OR char_length(trip_name) <= 200),
  start_date          date,
  end_date            date,
  destination_summary text CHECK (destination_summary IS NULL OR char_length(destination_summary) <= 1000),
  raw_notes           text CHECK (raw_notes IS NULL OR char_length(raw_notes) <= 8000),
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_review','needs_clarification','approved','rejected')),
  linked_itinerary_id uuid REFERENCES public.itineraries(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ttr_linked_only_when_approved CHECK (linked_itinerary_id IS NULL OR status = 'approved')
);

CREATE TABLE IF NOT EXISTS public.traveller_trip_request_segments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_request_id        uuid NOT NULL REFERENCES public.traveller_trip_requests(id) ON DELETE CASCADE,
  segment_type           text NOT NULL DEFAULT 'unknown'
                           CHECK (segment_type IN ('air','hotel','ground','driving','train','ferry','activity','other','unknown')),
  start_time             timestamptz,
  end_time               timestamptz,
  origin                 text CHECK (origin IS NULL OR char_length(origin) <= 300),
  destination            text CHECK (destination IS NULL OR char_length(destination) <= 300),
  location_name          text CHECK (location_name IS NULL OR char_length(location_name) <= 300),
  address                text CHECK (address IS NULL OR char_length(address) <= 500),
  carrier_or_provider    text CHECK (carrier_or_provider IS NULL OR char_length(carrier_or_provider) <= 200),
  flight_or_train_number text CHECK (flight_or_train_number IS NULL OR char_length(flight_or_train_number) <= 100),
  confirmation_reference text CHECK (confirmation_reference IS NULL OR char_length(confirmation_reference) <= 200),
  notes                  text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  missing_fields         text[] NOT NULL DEFAULT '{}',
  confidence             numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ttr_traveler   ON public.traveller_trip_requests(traveler_id);
CREATE INDEX IF NOT EXISTS idx_ttr_client     ON public.traveller_trip_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_ttr_created_by ON public.traveller_trip_requests(created_by, status);
CREATE INDEX IF NOT EXISTS idx_ttrs_request   ON public.traveller_trip_request_segments(trip_request_id);

DROP TRIGGER IF EXISTS update_ttr_updated_at ON public.traveller_trip_requests;
CREATE TRIGGER update_ttr_updated_at BEFORE UPDATE ON public.traveller_trip_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_travel_updated_at();

ALTER TABLE public.traveller_trip_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traveller_trip_request_segments ENABLE ROW LEVEL SECURITY;

-- Traveller: SELECT own only (created_by = auth.uid()).
CREATE POLICY ttr_traveller_select_own ON public.traveller_trip_requests
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- Operator (analyst/admin/super_admin): SELECT scoped to accessible clients (NOT is_super_admin-OR-all).
CREATE POLICY ttr_operator_select ON public.traveller_trip_requests
  FOR SELECT TO authenticated
  USING (
    (is_super_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'analyst'::app_role))
    AND client_id IN (SELECT g.client_id FROM public.get_user_accessible_client_ids(auth.uid()) g)
  );

-- NO direct traveller INSERT/UPDATE/DELETE policies. All traveller writes go through the Slice B
-- self-scoped service-role function (server-binds traveler_id/client_id/created_by; enforces
-- draft→pending_review only; never approved/rejected; never sets linked_itinerary_id). Operator
-- review/approval writes = later slice. service_role bypasses RLS. No public policies.

CREATE POLICY ttrs_traveller_select_own ON public.traveller_trip_request_segments
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY ttrs_operator_select ON public.traveller_trip_request_segments
  FOR SELECT TO authenticated
  USING (
    (is_super_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'analyst'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.traveller_trip_requests r
      WHERE r.id = trip_request_id
        AND r.client_id IN (SELECT g.client_id FROM public.get_user_accessible_client_ids(auth.uid()) g)
    )
  );
