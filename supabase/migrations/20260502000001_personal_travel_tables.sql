-- Personal travel tables for the AEGIS Mobile PWA.
--
-- These are operator-personal trips (one operator's own travel) and are
-- distinct from the Fortress webapp's `itineraries` / `travel_alerts`
-- (which track CLIENT travel for analyst monitoring).
--
-- The mobile hook in slow-and-steady-love expected `travel_itineraries`,
-- `travel_flights`, `travel_alerts` with `user_id`-scoped rows. Two of
-- those names already existed in this DB with totally different schemas
-- (the Fortress operational-travel tables). Rather than overload one
-- schema with two domains, we sandbox the operator-personal data under
-- `personal_*` names with `user_id = auth.uid()` RLS.

-- ── personal_trips ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date DATE,
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_trips_user      ON public.personal_trips(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_trips_departure ON public.personal_trips(user_id, departure_date);

ALTER TABLE public.personal_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal_trips_owner_select"
  ON public.personal_trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "personal_trips_owner_insert"
  ON public.personal_trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trips_owner_update"
  ON public.personal_trips FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trips_owner_delete"
  ON public.personal_trips FOR DELETE USING (auth.uid() = user_id);

-- ── personal_trip_flights ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_trip_flights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itinerary_id UUID REFERENCES public.personal_trips(id) ON DELETE CASCADE,
  flight_number TEXT NOT NULL,
  airline TEXT,
  reservation_code TEXT,
  departure_airport TEXT NOT NULL,
  arrival_airport TEXT NOT NULL,
  departure_time TIMESTAMPTZ NOT NULL,
  arrival_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'delayed', 'cancelled', 'departed', 'arrived')),
  gate TEXT,
  terminal TEXT,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  delay_reason TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_trip_flights_user      ON public.personal_trip_flights(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_trip_flights_itinerary ON public.personal_trip_flights(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_personal_trip_flights_departure ON public.personal_trip_flights(user_id, departure_time);

ALTER TABLE public.personal_trip_flights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal_trip_flights_owner_select"
  ON public.personal_trip_flights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "personal_trip_flights_owner_insert"
  ON public.personal_trip_flights FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trip_flights_owner_update"
  ON public.personal_trip_flights FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trip_flights_owner_delete"
  ON public.personal_trip_flights FOR DELETE USING (auth.uid() = user_id);

-- The flight-auto-scan edge function runs as service_role and writes
-- back live status (delay_minutes, gate, etc.). Service role already
-- bypasses RLS, so no extra policy needed.

-- ── personal_trip_alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_trip_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itinerary_id UUID REFERENCES public.personal_trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT,
  location TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_trip_alerts_user    ON public.personal_trip_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_trip_alerts_unread  ON public.personal_trip_alerts(user_id, is_read) WHERE is_read = false;

ALTER TABLE public.personal_trip_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal_trip_alerts_owner_select"
  ON public.personal_trip_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "personal_trip_alerts_owner_insert"
  ON public.personal_trip_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trip_alerts_owner_update"
  ON public.personal_trip_alerts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_trip_alerts_owner_delete"
  ON public.personal_trip_alerts FOR DELETE USING (auth.uid() = user_id);

-- ── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._personal_travel_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS personal_trips_updated_at ON public.personal_trips;
CREATE TRIGGER personal_trips_updated_at
  BEFORE UPDATE ON public.personal_trips
  FOR EACH ROW EXECUTE FUNCTION public._personal_travel_touch_updated_at();

DROP TRIGGER IF EXISTS personal_trip_flights_updated_at ON public.personal_trip_flights;
CREATE TRIGGER personal_trip_flights_updated_at
  BEFORE UPDATE ON public.personal_trip_flights
  FOR EACH ROW EXECUTE FUNCTION public._personal_travel_touch_updated_at();
