import { supabase } from "@/integrations/supabase/client";
import { formatFunctionInvokeErrorAsync } from "@/lib/functionInvokeError";

// Single client-side entry point for operator travel-record mutations. Routes through
// the scoped, audited `travel-record-mutate` edge function (Phases 3/4) instead of
// direct PostgREST writes, so tenant/client containment + audit are enforced server-side.
export interface TravelMutateResult {
  success: boolean;
  action?: string;
  table_name?: string;
  record_id?: string;
  audit_id?: string | null;
  proposal_id?: string;
  approval_status?: string;
  changed_fields?: string[];
  error?: string;
  message?: string;
  status?: string;
  [k: string]: unknown;
}

export async function travelMutate(body: Record<string, unknown>): Promise<TravelMutateResult> {
  const { data, error } = await supabase.functions.invoke("travel-record-mutate", { body });
  if (error) {
    const msg = await formatFunctionInvokeErrorAsync(error);
    throw new Error(msg || "Travel mutation failed");
  }
  const result = (data ?? {}) as TravelMutateResult;
  if (result.success === false) {
    throw new Error(result.error || result.message || "Travel mutation failed");
  }
  return result;
}
