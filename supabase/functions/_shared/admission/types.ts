// _shared/admission/types.ts
// DGIC admission controller — shared types (Phase B: controller extraction).
// Additive; no behavior. No DGIC enforcement, no quality_status change in Phase B.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Classification =
  | { mode: "external"; acquisition: "crawled" | "supplied" }
  | { mode: "asserted"; subtype: "document" }
  | { mode: "synthetic" };

export type Outcome = "admitted" | "rejected" | "deduplicated" | "updated";
export type PayloadShape = "rejected" | "deduplicated" | "accepted";

// Mode-agnostic admission input. The external/crawled subset == exactly what ingest-signal
// extracts from its validated body today (no new inputs required of the caller).
export interface SignalCandidate {
  title?: string | null;
  text?: string | null;
  event?: unknown;
  location?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  source_key?: string | null;
  platform?: string | null;
  client_id?: string | null;
  tenant_id?: string | null;
  tenant_broadcast?: unknown;
  skip_relevance_gate?: boolean;
  fallback_category?: string | null;
  fallback_severity?: string | null;
  is_test?: boolean;
  raw_json?: Record<string, unknown> | null;
  // mode-specific provenance (optional; read by their profiles only — unused by external/crawled)
  contributing_signal_ids?: string[];
  asserted_by?: string | null;
  source_artifact_id?: string | null;
  supplied_by?: string | null;
  extraction_anchor?: string | null;
}

export interface AdmissionContext {
  supabase: SupabaseClient;
  caller: { kind: string; id?: string | null }; // preserved verbatim from ingest-signal; never rebuilt
  requestStartedAt: number;                      // for duration_ms parity
  dryRun?: boolean;                              // parity harness: capture-intent, execute NO writes
  logger?: (line: string) => void;              // wrap console.* so log lines are preserved verbatim
}

export interface DryRunEffect {
  kind: "insert" | "update" | "upsert" | "telemetry" | "dlq";
  target: string;                                // table name or telemetry function_name
  payload: Record<string, unknown>;
}

// Rich enough to reproduce EVERY current ingest-signal response byte-for-byte (the caller maps
// this back to the identical HTTP body + status per the §5 branch table).
export interface AdmissionResult {
  outcome: Outcome;
  signal_id?: string;            // admitted
  existing_signal_id?: string;   // deduplicated / updated
  reason?: string;               // reject/dedup reason code (current strings verbatim)
  detail?: string;               // human message (current strings verbatim)
  httpStatusHint: number;        // 200 | 400 | 501 (today's status per branch)
  payloadShape: PayloadShape;    // selects the exact JSON envelope
  body?: unknown;                // the EXACT JSON object legacy passes to JSON.stringify (byte-parity)
  extra?: Record<string, unknown>; // per-branch body fields (relevance_score, ticket, phase, ...)
  proposedEffects?: DryRunEffect[]; // dry-run only: would-be writes, none executed
  dgic?: unknown;                // null in Phase B (dgicStage is a no-op)
}

export type StageResult = { kind: "continue" } | { kind: "terminal"; result: AdmissionResult };
