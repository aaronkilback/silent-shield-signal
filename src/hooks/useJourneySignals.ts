import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

// Operator Journey Monitoring (read-only). Surfaces traveller-reported Fortress journey
// status events (traveller_journey_events) to operators for the selected client only.
// RLS tje_operator_select already scopes analyst/admin/super_admin to accessible clients;
// we additionally filter by selectedClientId to keep tenant-view scoping explicit. This
// hook NEVER writes — no insert/update/delete, no functions.invoke, no mutation.
export interface JourneyEvent {
  id: string;
  event_type: string; // safe | arrived | at_pickup | in_vehicle | need_assistance
  note: string | null;
  created_at: string;
  traveler_id: string | null;
  itinerary_id: string | null;
  traveler_name: string | null;
  trip_name: string | null;
  last_check_in_at: string | null;
  next_check_in_due_at: string | null;
  journey_overdue: boolean | null;
}

export function useJourneySignals() {
  const { selectedClientId } = useClientSelection();
  return useQuery<JourneyEvent[]>({
    queryKey: ["journey-signals", selectedClientId],
    enabled: !!selectedClientId,
    refetchInterval: 30000,
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from("traveller_journey_events")
        .select(`
          id, event_type, note, created_at, traveler_id, itinerary_id,
          travelers:traveler_id ( name ),
          itineraries:itinerary_id ( trip_name, last_check_in_at, next_check_in_due_at, journey_overdue )
        `)
        .eq("client_id", selectedClientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        event_type: r.event_type,
        note: r.note ?? null,
        created_at: r.created_at,
        traveler_id: r.traveler_id,
        itinerary_id: r.itinerary_id,
        traveler_name: r.travelers?.name ?? null,
        trip_name: r.itineraries?.trip_name ?? null,
        last_check_in_at: r.itineraries?.last_check_in_at ?? null,
        next_check_in_due_at: r.itineraries?.next_check_in_due_at ?? null,
        journey_overdue: r.itineraries?.journey_overdue ?? null,
      }));
    },
  });
}

// Latest event per itinerary (events arrive newest-first).
export function latestPerItinerary(events: JourneyEvent[]): JourneyEvent[] {
  const seen = new Set<string>();
  const out: JourneyEvent[] = [];
  for (const e of events) {
    const key = e.itinerary_id ?? e.id;
    if (!seen.has(key)) { seen.add(key); out.push(e); }
  }
  return out;
}
