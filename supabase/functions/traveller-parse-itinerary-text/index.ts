// traveller-parse-itinerary-text — Slice D3. A NON-WRITING LLM helper that turns a traveller's
// pasted, messy itinerary text into STRUCTURED SUGGESTIONS only. It never writes, never retrieves
// operator/intel data, never chooses scope, and never creates operational authority.
//
// Core rule: LLM suggests → traveller confirms → traveller-trip-intake writes → operator approves
// → Fortress monitors. This function is ONLY the "LLM suggests" step. Confirmed suggestions are
// persisted exclusively by the proven, self-scoped traveller-trip-intake function (add_segment /
// create_draft / update_draft / submit_for_review). Nothing here touches a write path.
//
// Boundaries (verify_jwt=true; boundary = travelers.user_id = auth.uid()):
//   - getCallerIdentity(req): reject service_role + unauthorized; user_id comes from auth ONLY.
//   - The service-role client is used for ONE read-only purpose: the linkage lookup on `travelers`
//     (select id, client_id, user_id WHERE user_id = auth.uid()). Approved exception (D3) because
//     live prod RLS only grants travelers SELECT to operators, so a traveller cannot self-select
//     under their own JWT. NO writes, NO other table reads, NO operational/intel reads.
//   - body.client_id / body.traveler_id / body.tenant_id (and any such tokens inside raw_text) are
//     NEVER read or used. Scope is irrelevant here — this function persists nothing.
//   - The LLM call carries NO tools and NO extraBody; guardrails stay ON; output is strict JSON,
//     re-validated/sanitized server-side before return.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
} from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

const MAX_TEXT = 12 * 1024; // 12 KB cap on pasted text (cost / abuse bound)
const SEGMENT_TYPES = new Set(["air", "hotel", "ground", "driving", "train", "ferry", "activity", "other", "unknown"]);

// String caps mirror traveller-trip-intake's allow-list so a suggestion can map 1:1 to add_segment.
const STR_CAPS: Record<string, number> = {
  suggested_trip_name: 200, destination_summary: 1000,
  start_time: 40, end_time: 40, start_date: 40, end_date: 40,
  origin: 300, destination: 300, location_name: 300, address: 500,
  carrier_or_provider: 200, flight_or_train_number: 100, confirmation_reference: 200, notes: 2000,
};

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
function cleanStrArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => String(x).trim()).filter(Boolean).slice(0, maxItems).map((x) => x.slice(0, maxLen));
}
function clampConfidence(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// Re-validate/sanitize the model's JSON into the strict D3 schema. A misbehaving model cannot
// return off-enum types, out-of-range confidence, over-long strings, or oversized arrays.
function sanitizeParse(raw: unknown) {
  const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const tsRaw = (obj.trip_summary && typeof obj.trip_summary === "object") ? obj.trip_summary as Record<string, unknown> : {};
  const trip_summary = {
    suggested_trip_name: cleanStr(tsRaw.suggested_trip_name, STR_CAPS.suggested_trip_name),
    start_date: cleanStr(tsRaw.start_date, STR_CAPS.start_date),
    end_date: cleanStr(tsRaw.end_date, STR_CAPS.end_date),
    destination_summary: cleanStr(tsRaw.destination_summary, STR_CAPS.destination_summary),
  };

  const segsRaw = Array.isArray(obj.segments) ? obj.segments : [];
  const segments = segsRaw.slice(0, 40).map((s) => {
    const seg = (s && typeof s === "object") ? s as Record<string, unknown> : {};
    const rawType = String(seg.segment_type ?? "");
    return {
      segment_type: SEGMENT_TYPES.has(rawType) ? rawType : "unknown", // coerce invalid → unknown
      start_time: cleanStr(seg.start_time, STR_CAPS.start_time),
      end_time: cleanStr(seg.end_time, STR_CAPS.end_time),
      origin: cleanStr(seg.origin, STR_CAPS.origin),
      destination: cleanStr(seg.destination, STR_CAPS.destination),
      location_name: cleanStr(seg.location_name, STR_CAPS.location_name),
      address: cleanStr(seg.address, STR_CAPS.address),
      carrier_or_provider: cleanStr(seg.carrier_or_provider, STR_CAPS.carrier_or_provider),
      flight_or_train_number: cleanStr(seg.flight_or_train_number, STR_CAPS.flight_or_train_number),
      confirmation_reference: cleanStr(seg.confirmation_reference, STR_CAPS.confirmation_reference),
      notes: cleanStr(seg.notes, STR_CAPS.notes),
      missing_fields: cleanStrArray(seg.missing_fields, 30, 60),
      confidence: clampConfidence(seg.confidence),
    };
  });

  return {
    trip_summary,
    segments,
    questions: cleanStrArray(obj.questions, 12, 300),
    warnings: cleanStrArray(obj.warnings, 12, 300),
  };
}

const SYSTEM_PROMPT = [
  "You parse a traveller's own pasted, messy itinerary text into STRUCTURED SUGGESTIONS only.",
  "You do not write to any database, you do not take actions, and you produce suggestions a human will review.",
  "Rules:",
  "- Parse only what the text says. Do NOT invent exact details (no made-up flight numbers, confirmation codes, hotel names, addresses, or precise times).",
  "- If a value is uncertain or absent, set it to null and add the field name to that segment's missing_fields.",
  "- Never claim anything is monitored, tracked, booked, confirmed, or that a security team has been notified.",
  "- Do not provide safety, risk, threat, or security intelligence of any kind.",
  "- Do not reference any internal company, Fortress, or operator data — you have none.",
  "- Companions/other people named in the text are NOT system travellers; mention them only inside a segment's notes if relevant.",
  "- Do not create alerts. Do not approve anything. Do not choose any client/traveller/tenant scope or ID.",
  "- segment_type must be one of: air, hotel, ground, driving, train, ferry, activity, other, unknown.",
  "- confidence is your own 0..1 estimate of how clearly the text supports that segment.",
  "- Use ISO dates (YYYY-MM-DD) and ISO datetimes (YYYY-MM-DDTHH:mm:ss) only when clearly stated; otherwise null.",
  "Output STRICT JSON ONLY (no prose, no markdown) matching exactly:",
  `{"trip_summary":{"suggested_trip_name":string|null,"start_date":string|null,"end_date":string|null,"destination_summary":string|null},"segments":[{"segment_type":"air|hotel|ground|driving|train|ferry|activity|other|unknown","start_time":string|null,"end_time":string|null,"origin":string|null,"destination":string|null,"location_name":string|null,"address":string|null,"carrier_or_provider":string|null,"flight_or_train_number":string|null,"confirmation_reference":string|null,"notes":string|null,"missing_fields":string[],"confidence":number}],"questions":string[],"warnings":string[]}`,
].join("\n");

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // 1. Caller identity — require a real user JWT; reject machine/service callers.
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: traveller-parse-itinerary-text is for authenticated traveller users only", 403);
  }
  const userId = caller.userId;

  // 2. Read-only linkage lookup (the ONLY service-role use; no writes, no other tables).
  const svc = createServiceClient();
  const { data: travelers, error: travErr } = await svc
    .from("travelers").select("id, client_id, user_id").eq("user_id", userId);
  if (travErr) { console.error("[traveller-parse-itinerary-text] traveler lookup failed:", travErr); return errorResponse("lookup failed", 500); }
  if (!travelers || travelers.length === 0) {
    return errorResponse("NOT_LINKED: no traveller profile is linked to this account", 403);
  }
  if (travelers.length > 1) {
    return errorResponse("AMBIGUOUS_TRAVELER: multiple linked travellers not supported in v1", 409);
  }
  // NOTE: linkage proven. We deliberately do NOT use traveler.id/client_id for anything — this
  // function persists nothing, so no scope is ever needed or chosen.

  // 3. Input — raw_text ONLY. client_id / traveler_id / tenant_id (body or text) are never read.
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const rawTextIn = typeof body.raw_text === "string" ? body.raw_text : "";
  const raw_text = rawTextIn.slice(0, MAX_TEXT).trim(); // hard 12 KB cap
  if (raw_text.length < 3) return errorResponse("EMPTY_TEXT: paste some itinerary details first", 400);

  // 4. The LLM call — guardrails ON (default), NO tools, NO extraBody, NO retrieval.
  const { data: parsed, error: aiErr, circuitOpen } = await callAiGatewayJson({
    model: "openai/gpt-4o-mini",
    functionName: "traveller-parse-itinerary-text",
    retries: 1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Itinerary text to parse into suggestions:\n\n${raw_text}` },
    ],
  });

  if (aiErr || !parsed) {
    console.warn("[traveller-parse-itinerary-text] gateway error:", aiErr, "circuitOpen:", circuitOpen);
    return errorResponse(circuitOpen ? "AI_UNAVAILABLE: please try again shortly" : "PARSE_FAILED: couldn't read that text — try rephrasing", 502);
  }

  // 5. Re-validate/sanitize into the strict schema before returning. Suggestions only.
  const suggestions = sanitizeParse(parsed);
  return successResponse({ success: true, suggestions });
});
