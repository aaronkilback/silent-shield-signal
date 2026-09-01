// DGIC wiring parity harness (Phase B). Proves mapResultToResponse turns each TERMINAL
// AdmissionResult into the EXACT legacy HTTP Response (byte-identical body + status +
// Content-Type). The bodies here are the same objects the stage slices already proved
// byte-identical to legacy; this confirms the serialize + status mapping is faithful.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapResultToResponse } from "../wiring.ts";
import type { AdmissionResult } from "../types.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };

const CASES: Array<{ name: string; result: AdmissionResult; status: number; body: unknown }> = [
  {
    name: "missing_client_id (400)",
    result: { outcome: "rejected", reason: "missing_client_id", httpStatusHint: 400, payloadShape: "rejected", body: { status: "rejected", reason: "missing_client_id", message: "client_id is required. Cross-tenant signal scoring was removed 2026-05-23 (#256) — callers must pass an explicit client_id or use tenant_broadcast (Phase 3, not yet implemented).", ticket: "#256", phase: 1, source_key: "x" } },
    status: 400, body: { status: "rejected", reason: "missing_client_id", message: "client_id is required. Cross-tenant signal scoring was removed 2026-05-23 (#256) — callers must pass an explicit client_id or use tenant_broadcast (Phase 3, not yet implemented).", ticket: "#256", phase: 1, source_key: "x" },
  },
  {
    name: "broadcast_not_implemented (501)",
    result: { outcome: "rejected", reason: "broadcast_not_implemented", httpStatusHint: 501, payloadShape: "rejected", body: { status: "rejected", reason: "broadcast_not_implemented", message: "tenant_broadcast routing (scope=industry) is reserved for #256 Phase 3 and not yet implemented. Until then, pass an explicit client_id.", ticket: "#256", phase: 1 } },
    status: 501, body: { status: "rejected", reason: "broadcast_not_implemented", message: "tenant_broadcast routing (scope=industry) is reserved for #256 Phase 3 and not yet implemented. Until then, pass an explicit client_id.", ticket: "#256", phase: 1 },
  },
  {
    name: "F-034.1 null_source_url (200)",
    result: { outcome: "rejected", reason: "null_source_url", httpStatusHint: 200, payloadShape: "rejected", body: { status: "rejected", reason: "null_source_url", message: "source_url required for auditable signal provenance" } },
    status: 200, body: { status: "rejected", reason: "null_source_url", message: "source_url required for auditable signal provenance" },
  },
  {
    name: "duplicate_url (200)",
    result: { outcome: "deduplicated", reason: "duplicate_url", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: "u1", body: { status: "suppressed", reason: "duplicate_url", existing_signal_id: "u1" } },
    status: 200, body: { status: "suppressed", reason: "duplicate_url", existing_signal_id: "u1" },
  },
  {
    name: "exact duplicate (409)",
    result: { outcome: "rejected", reason: "exact_duplicate", httpStatusHint: 409, payloadShape: "deduplicated", body: { error: "Duplicate signal detected and blocked", duplicate_of: "d1", message: "Exact match found" } },
    status: 409, body: { error: "Duplicate signal detected and blocked", duplicate_of: "d1", message: "Exact match found" },
  },
  {
    name: "ai_relevance_gate reject (200)",
    result: { outcome: "rejected", reason: "ai_relevance_gate", httpStatusHint: 200, payloadShape: "rejected", body: { status: "rejected", reason: "ai_relevance_gate", relevance_score: 0.1, primary_connection: "none", detail: "no connection", message: "Signal rejected by AI relevance gate — not actionable intelligence for this client" } },
    status: 200, body: { status: "rejected", reason: "ai_relevance_gate", relevance_score: 0.1, primary_connection: "none", detail: "no connection", message: "Signal rejected by AI relevance gate — not actionable intelligence for this client" },
  },
  {
    name: "relevance suppress (200)",
    result: { outcome: "rejected", reason: "noise", httpStatusHint: 200, payloadShape: "rejected", body: { status: "suppressed", reason: "noise", relevance_score: 0.1, matched_patterns: ["p1"], message: "Signal suppressed by relevance filter based on learned patterns" } },
    status: 200, body: { status: "suppressed", reason: "noise", relevance_score: 0.1, matched_patterns: ["p1"], message: "Signal suppressed by relevance filter based on learned patterns" },
  },
];

for (const c of CASES) {
  Deno.test(`wiring: mapResultToResponse → exact legacy Response: ${c.name}`, async () => {
    const res = mapResultToResponse(c.result, CORS);
    assertEquals(res.status, c.status, "status");
    assertEquals(res.headers.get("Content-Type"), "application/json", "content-type");
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*", "cors preserved");
    assertEquals(await res.text(), JSON.stringify(c.body), "byte-identical body");
  });
}
