import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

// Operator Trip Request Review (Slice E1) — READ-ONLY. Surfaces traveller-submitted pending
// trip requests (traveller_trip_requests + traveller_trip_request_segments) to operators for the
// selected client only. Reuses the proven Slice A operator RLS (ttr_operator_select /
// ttrs_operator_select scope analyst/admin/super_admin to get_user_accessible_client_ids); the
// explicit selectedClientId filter keeps tenant-view scoping. NEVER writes — no insert/update/
// delete, no functions.invoke, no operational-table access. These are NOT operational trips.
export interface TripRequestSegment {
  id: string;
  segment_type: string;
  start_time: string | null;
  end_time: string | null;
  origin: string | null;
  destination: string | null;
  location_name: string | null;
  address: string | null;
  carrier_or_provider: string | null;
  flight_or_train_number: string | null;
  confirmation_reference: string | null;
  notes: string | null;
  missing_fields: string[] | null;
  confidence: number | null;
}
export interface TripRequest {
  id: string;
  trip_name: string | null;
  start_date: string | null;
  end_date: string | null;
  destination_summary: string | null;
  raw_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  traveler_id: string | null;
  traveler_name: string | null;
  segments: TripRequestSegment[];
}

export function useTripRequests() {
  const { selectedClientId } = useClientSelection();
  return useQuery<TripRequest[]>({
    queryKey: ["operator-trip-requests", selectedClientId],
    enabled: !!selectedClientId,
    refetchInterval: 30000,
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from("traveller_trip_requests")
        .select(`
          id, trip_name, start_date, end_date, destination_summary, raw_notes, status, created_at, updated_at, traveler_id,
          travelers:traveler_id ( name ),
          traveller_trip_request_segments ( id, segment_type, start_time, end_time, origin, destination, location_name, address, carrier_or_provider, flight_or_train_number, confirmation_reference, notes, missing_fields, confidence )
        `)
        .eq("client_id", selectedClientId)
        .in("status", ["pending_review", "needs_clarification"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        trip_name: r.trip_name ?? null,
        start_date: r.start_date ?? null,
        end_date: r.end_date ?? null,
        destination_summary: r.destination_summary ?? null,
        raw_notes: r.raw_notes ?? null,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        traveler_id: r.traveler_id ?? null,
        traveler_name: r.travelers?.name ?? null,
        segments: (r.traveller_trip_request_segments ?? []) as TripRequestSegment[],
      }));
    },
  });
}
