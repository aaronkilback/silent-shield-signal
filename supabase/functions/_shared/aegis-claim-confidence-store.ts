// supabase/functions/_shared/aegis-claim-confidence-store.ts
//
// Workstream D — slim slice — append-only persistence helper for confidence snapshots.
//
// HARD RULES:
//   • Single INSERT entry point. No UPDATE/DELETE helpers exist — the table is
//     append-only and validation transitions are new INSERTs.
//   • tenant_id NOT NULL is enforced by the DB trigger; this helper refuses to
//     issue an INSERT with null tenant (fail closed before the round-trip).
//   • Best-effort: errors are logged but never thrown into the request closure
//     (mirrors Flight Recorder discipline so confidence persistence never
//     breaks a user-facing flow).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { ClaimType, ConfidenceAxes, SourceRecord } from "./aegis-confidence.ts";

export interface RecordClaimConfidenceInput {
  tenant_id: string;
  claim_type: ClaimType;
  claim_subject_kind: string;       // 'entity'|'relationship'|'signal'|'investigation'|...
  claim_subject_id?: string | null;
  claim_payload: Record<string, unknown>;
  axes: ConfidenceAxes;
  sources: SourceRecord[];
  debug_trace_id?: string | null;
  operator_note?: string | null;
}

export interface RecordClaimConfidenceResult {
  persisted: boolean;
  id?: string;
  error?: string;
}

export async function recordClaimConfidence(
  sb: SupabaseClient,
  input: RecordClaimConfidenceInput,
): Promise<RecordClaimConfidenceResult> {
  if (!input.tenant_id) {
    return {
      persisted: false,
      error: "tenant_id required (Provenance Doctrine — fail closed before DB round-trip)",
    };
  }

  try {
    const { data, error } = await sb
      .from("aegis_claim_confidence")
      .insert({
        tenant_id: input.tenant_id,
        claim_type: input.claim_type,
        claim_subject_kind: input.claim_subject_kind,
        claim_subject_id: input.claim_subject_id ?? null,
        claim_payload: input.claim_payload,
        corroboration: input.axes.corroboration,
        provenance_quality: input.axes.provenance_quality,
        freshness: input.axes.freshness,
        validation_state: input.axes.validation_state,
        trajectory_confidence: input.axes.trajectory_confidence,
        grounded: input.axes.grounded,
        sources_jsonb: input.sources,
        debug_trace_id: input.debug_trace_id ?? null,
        operator_note: input.operator_note ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[aegis-claim-confidence] insert failed (best-effort):", error.message);
      return { persisted: false, error: error.message };
    }
    return { persisted: true, id: data?.id };
  } catch (err) {
    console.warn("[aegis-claim-confidence] insert threw (best-effort):", (err as Error).message);
    return { persisted: false, error: (err as Error).message };
  }
}
