// _shared/admission/flag.ts
// DB-backed runtime rollback flag for the admission controller (Phase B).
// Env-var hot-swap is NOT reliable for warm Supabase Edge isolates (value is fixed at isolate
// boot; secret changes need redeploy/recycle), so the cutover decision lives in dgic_config and
// is read FRESH per invocation — the one value we deliberately never cache.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const FLAG_KEY = "admission_controller_enabled";

/**
 * FAIL-SAFE to legacy: any error, missing row, or non-'true' value => false => the legacy
 * (authoritative) admission path runs. A flip of the dgic_config row takes effect on the next
 * invocation with no redeploy. Legacy stays default until parity is proven + burn-in passes.
 */
export async function isAdmissionControllerEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("dgic_config")
      .select("value")
      .eq("key", FLAG_KEY)
      .maybeSingle();
    if (error) return false;
    return data?.value === "true";
  } catch {
    return false;
  }
}
