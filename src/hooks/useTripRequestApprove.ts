import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

// Operator approval (Slice E3b). Calls the proven operator-only operator-trip-request-approve
// function, which (via the SECURITY DEFINER RPC) atomically creates ONE operational itinerary +
// itinerary_travelers link, flips the request to approved, and audits. selectedClientId is passed
// from operator context but the function re-validates it (accessible + === request.client_id);
// traveler_id/client_id are server-derived. This UI hook never writes operational tables directly.
export interface ApproveVars {
  request_id: string;
  trip_name: string;
  departure_date: string;
  return_date: string;
  origin_city: string;
  origin_country: string;
  destination_city: string;
  destination_country: string;
  trip_type?: string;
}

export function useTripRequestApprove() {
  const qc = useQueryClient();
  const { selectedClientId } = useClientSelection();
  return useMutation<{ itinerary_id?: string; status?: string }, Error, ApproveVars>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("operator-trip-request-approve", {
        body: { ...vars, selectedClientId },
      });
      if (error) {
        // Surface the function's error body (e.g. MISSING_REQUIRED_FIELDS: ...) when present.
        let msg = error.message;
        try {
          const ctx = (error as unknown as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const b = await ctx.json();
            if (b?.error) msg = b.error;
          }
        } catch { /* fall back to error.message */ }
        throw new Error(msg);
      }
      return data as { itinerary_id?: string; status?: string };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-trip-requests"] }); },
  });
}
