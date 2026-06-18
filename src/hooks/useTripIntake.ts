import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Traveller Trip Intake (Slice C) — the ONLY data path for the intake UI. Every call goes to
// the proven self-scoped traveller-trip-intake edge function (boundary travelers.user_id =
// auth.uid(); server-binds traveler_id/client_id/created_by; writes only the intake tables).
// NO direct PostgREST writes to intake or operational tables; NO Aegis; NO operator surfaces.
export type SegmentType =
  | "air" | "hotel" | "ground" | "driving" | "train" | "ferry" | "activity" | "other" | "unknown";

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
}
export interface TripSegment {
  id: string;
  trip_request_id: string;
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
  created_at: string;
}

async function invokeIntake(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("traveller-trip-intake", { body });
  if (error) throw error;
  return data as Record<string, unknown>;
}

// Read the traveller's own trip requests + segments (server returns only own).
export function useMyTripRequests() {
  return useQuery<{ requests: TripRequest[]; segments: TripSegment[] }>({
    queryKey: ["my-trip-requests"],
    queryFn: async () => {
      const d = await invokeIntake({ action: "list_requests" });
      return { requests: (d.requests as TripRequest[]) ?? [], segments: (d.segments as TripSegment[]) ?? [] };
    },
  });
}

// Single mutation for every intake action; the page passes the action + safe fields.
export function useTravellerTripIntake() {
  const qc = useQueryClient();
  return useMutation<Record<string, unknown>, Error, Record<string, unknown>>({
    mutationFn: (body) => invokeIntake(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-trip-requests"] }); },
  });
}
