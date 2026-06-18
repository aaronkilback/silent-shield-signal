import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

// Operator triage (Slice E2). Calls the operator-only operator-trip-request-review function to
// mark a pending traveller trip request as needs_clarification or rejected. NON-OPERATIONAL —
// the function writes only traveller_trip_requests; never creates itineraries/links/alerts and
// never sets approved/linked_itinerary_id. selectedClientId is passed from operator context but
// the function re-validates it (accessible + === request.client_id); it is not trusted authority.
export type ReviewAction = "needs_clarification" | "reject";

export function useTripRequestReview() {
  const qc = useQueryClient();
  const { selectedClientId } = useClientSelection();
  return useMutation<Record<string, unknown>, Error, { request_id: string; action: ReviewAction; review_note?: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("operator-trip-request-review", {
        body: { ...vars, selectedClientId },
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-trip-requests"] }); },
  });
}
