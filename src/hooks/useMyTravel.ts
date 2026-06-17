import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Traveller Portal v1 — the ONLY data call the portal makes. Invokes the scoped,
// read-only get-my-travel edge function (boundary = travelers.user_id = auth.uid()).
// No tenant/client params; no direct PostgREST; no operator/Aegis calls.
export interface MyTraveler {
  id: string;
  name: string | null;
  status: string | null;
  current_location: string | null;
  current_country: string | null;
  last_location_update: string | null;
  email: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}
export interface MyItinerary {
  id: string;
  trip_name: string | null;
  trip_type: string | null;
  departure_date: string | null;
  return_date: string | null;
  origin_city: string | null;
  origin_country: string | null;
  destination_city: string | null;
  destination_country: string | null;
  status: string | null;
  next_check_in_due_at: string | null;
  last_check_in_at: string | null;
  journey_overdue: boolean | null;
  hotel_name: string | null;
  // v1.1 — latest traveller-reported Fortress journey status (safe derived fields only).
  journey_status: { event_type: string; at: string; note: string | null } | null;
}
export interface MyAlert {
  id: string;
  itinerary_id: string | null;
  title: string | null;
  severity: string | null;
  alert_type: string | null;
  location: string | null;
  recommended_actions: string[] | null;
  is_active: boolean | null;
  acknowledged: boolean | null;
  created_at: string | null;
}
export interface MyTravel {
  linked: boolean;
  travelers: MyTraveler[];
  itineraries: MyItinerary[];
  alerts: MyAlert[];
}

// v1.1 — Fortress safety/journey status (NOT airline check-in). Self-scoped write via the
// traveller-journey-status edge function (boundary = travelers.user_id = auth.uid()).
export type JourneyEventType = "safe" | "arrived" | "at_pickup" | "in_vehicle" | "need_assistance";

export interface JourneyStatusResult {
  success: boolean;
  event_type: string;
  current_journey_status: string;
  checked_in: boolean;
  last_check_in_at: string | null;
  next_check_in_due_at: string | null;
  journey_overdue: boolean | null;
}

export function useTravellerJourneyStatus() {
  const qc = useQueryClient();
  return useMutation<JourneyStatusResult, Error, {
    itinerary_id: string;
    event_type: JourneyEventType;
    note?: string;
    current_location?: string;
    current_country?: string;
  }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("traveller-journey-status", { body: vars });
      if (error) throw error;
      return data as JourneyStatusResult;
    },
    // Refresh the read model so the new journey_status / check-in times appear.
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-travel"] }); },
  });
}

export function useMyTravel(itineraryId?: string) {
  return useQuery<MyTravel>({
    queryKey: ["my-travel", itineraryId ?? "all"],
    queryFn: async () => {
      const body = itineraryId ? { itinerary_id: itineraryId } : {};
      const { data, error } = await supabase.functions.invoke("get-my-travel", { body });
      if (error) throw error;
      const d = (data ?? {}) as Partial<MyTravel>;
      return {
        linked: !!d.linked,
        travelers: d.travelers ?? [],
        itineraries: d.itineraries ?? [],
        alerts: d.alerts ?? [],
      };
    },
  });
}
