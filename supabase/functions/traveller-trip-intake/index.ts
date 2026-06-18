// traveller-trip-intake — Traveller Trip Intake (Slice B). The ONLY safe write path for a
// linked traveller to create and manage their OWN pending, NON-OPERATIONAL trip requests.
//
// NOT operational: writes ONLY to traveller_trip_requests / traveller_trip_request_segments.
// Never touches itineraries, itinerary_travelers, travel_alerts, traveller_journey_events, or
// travel_record_edits. Approval into an operational itinerary is a LATER operator-only slice.
//
// verify_jwt=true. Boundary = travelers.user_id = auth.uid(). traveler_id / client_id /
// created_by are ALWAYS server-derived from the caller's linked traveler — never taken from the
// body or any model. status transitions are code-enforced: draft → pending_review only; never
// approved/rejected; linked_itinerary_id is never set here. Deterministic — no LLM, no parsing.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
} from "../_shared/supabase-client.ts";

const SEGMENT_TYPES = new Set(["air", "hotel", "ground", "driving", "train", "ferry", "activity", "other", "unknown"]);

// Safe, traveller-settable fields ONLY. Anything else in the body (traveler_id, client_id,
// tenant_id, created_by, linked_itinerary_id, status, risk/monitoring/operator/alert/assignment
// fields) is simply never read → ignored.
const REQUEST_SAFE_FIELDS = ["trip_name", "start_date", "end_date", "destination_summary", "raw_notes"];
const SEGMENT_SAFE_FIELDS = [
  "segment_type", "start_time", "end_time", "origin", "destination", "location_name", "address",
  "carrier_or_provider", "flight_or_train_number", "confirmation_reference", "notes", "missing_fields", "confidence",
];

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
const STR_CAPS: Record<string, number> = {
  trip_name: 200, destination_summary: 1000, raw_notes: 8000,
  origin: 300, destination: 300, location_name: 300, address: 500,
  carrier_or_provider: 200, flight_or_train_number: 100, confirmation_reference: 200, notes: 2000,
};

// Build a sanitized object containing ONLY allow-listed keys, with type/shape coercion.
function pickSafe(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null) { out[k] = null; continue; }
    if (k === "segment_type") { out[k] = SEGMENT_TYPES.has(String(v)) ? String(v) : "unknown"; continue; }
    if (k === "start_date" || k === "end_date") { out[k] = clampStr(v, 40); continue; }            // 'YYYY-MM-DD'; DB validates
    if (k === "start_time" || k === "end_time") { out[k] = clampStr(v, 40); continue; }             // ISO ts; DB validates
    if (k === "confidence") { const n = Number(v); out[k] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null; continue; }
    if (k === "missing_fields") {
      out[k] = Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 30).map((x) => String(x).slice(0, 60)) : [];
      continue;
    }
    out[k] = clampStr(v, STR_CAPS[k] ?? 500);
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // 1. Caller identity — require a real user JWT; reject machine/service callers.
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: traveller-trip-intake is for authenticated traveller users only", 403);
  }
  const userId = caller.userId;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const action = typeof body.action === "string" ? body.action.trim() : "";

  const svc = createServiceClient();

  // 2. Boundary: the caller's linked traveler row(s). NEVER from the body.
  const { data: travelers, error: travErr } = await svc
    .from("travelers").select("id, client_id").eq("user_id", userId);
  if (travErr) { console.error("[traveller-trip-intake] traveler lookup failed:", travErr); return errorResponse("lookup failed", 500); }
  if (!travelers || travelers.length === 0) {
    return errorResponse("NOT_LINKED: no traveller profile is linked to this account", 403);
  }
  // v1: server-derive a single linked traveler. body.traveler_id is ignored entirely.
  if (travelers.length > 1) {
    return errorResponse("AMBIGUOUS_TRAVELER: multiple linked travellers not supported in v1", 409);
  }
  const traveler = travelers[0] as { id: string; client_id: string };

  // Helper: load a request that the caller OWNS (created_by = auth.uid()). Generic 403 otherwise.
  async function loadOwnRequest(id: string) {
    const { data } = await svc.from("traveller_trip_requests")
      .select("id, created_by, status").eq("id", id).maybeSingle();
    if (!data || (data as { created_by: string }).created_by !== userId) return null;
    return data as { id: string; created_by: string; status: string };
  }
  const EDITABLE = new Set(["draft", "needs_clarification"]);

  if (action === "create_draft") {
    const safe = pickSafe(body, REQUEST_SAFE_FIELDS);
    const { data: created, error } = await svc.from("traveller_trip_requests").insert({
      ...safe,
      traveler_id: traveler.id,        // server-derived
      client_id: traveler.client_id,   // server-derived
      created_by: userId,              // server-derived
      status: "draft",
    }).select("id, status, trip_name, start_date, end_date, destination_summary, traveler_id, client_id, created_by, created_at").single();
    if (error || !created) { console.error("[traveller-trip-intake] create_draft failed:", error); return errorResponse("create failed", 500); }
    return successResponse({ success: true, action, request: created });
  }

  if (action === "add_segment") {
    const reqId = typeof body.trip_request_id === "string" ? body.trip_request_id.trim() : "";
    if (!reqId) return errorResponse("TRIP_REQUEST_ID_MISSING", 400);
    const r = await loadOwnRequest(reqId);
    if (!r) return errorResponse("REQUEST_NOT_AVAILABLE: not found or not owned by this traveller", 403);
    if (!EDITABLE.has(r.status)) return errorResponse(`NOT_EDITABLE: request is ${r.status}`, 409);
    const safe = pickSafe(body, SEGMENT_SAFE_FIELDS);
    if (!("segment_type" in safe)) safe.segment_type = "unknown";
    const { data: seg, error } = await svc.from("traveller_trip_request_segments").insert({
      ...safe,
      trip_request_id: reqId,
      created_by: userId,              // server-derived
    }).select("id, trip_request_id, segment_type, start_time, end_time, origin, destination, location_name, address, carrier_or_provider, flight_or_train_number, confirmation_reference, notes, missing_fields, confidence, created_at").single();
    if (error || !seg) { console.error("[traveller-trip-intake] add_segment failed:", error); return errorResponse("add_segment failed", 500); }
    return successResponse({ success: true, action, segment: seg });
  }

  if (action === "update_draft") {
    const reqId = typeof body.trip_request_id === "string" ? body.trip_request_id.trim() : "";
    if (!reqId) return errorResponse("TRIP_REQUEST_ID_MISSING", 400);
    const r = await loadOwnRequest(reqId);
    if (!r) return errorResponse("REQUEST_NOT_AVAILABLE: not found or not owned by this traveller", 403);
    if (!EDITABLE.has(r.status)) return errorResponse(`NOT_EDITABLE: request is ${r.status}`, 409);
    const safe = pickSafe(body, REQUEST_SAFE_FIELDS); // never status / linked_itinerary_id / scope
    if (Object.keys(safe).length === 0) return errorResponse("NO_SAFE_FIELDS", 400);
    const { data: upd } = await svc.from("traveller_trip_requests")
      .update(safe).eq("id", reqId).eq("created_by", userId).in("status", ["draft", "needs_clarification"])
      .select("id, status, trip_name, start_date, end_date, destination_summary, raw_notes, updated_at").maybeSingle();
    if (!upd) return errorResponse("NOT_EDITABLE: 0 rows changed", 409);
    return successResponse({ success: true, action, request: upd });
  }

  if (action === "submit_for_review") {
    const reqId = typeof body.trip_request_id === "string" ? body.trip_request_id.trim() : "";
    if (!reqId) return errorResponse("TRIP_REQUEST_ID_MISSING", 400);
    const r = await loadOwnRequest(reqId);
    if (!r) return errorResponse("REQUEST_NOT_AVAILABLE: not found or not owned by this traveller", 403);
    if (r.status === "pending_review") {
      return successResponse({ success: true, action, request: { id: reqId, status: "pending_review" }, idempotent: true });
    }
    if (!EDITABLE.has(r.status)) return errorResponse(`CANNOT_SUBMIT: request is ${r.status}`, 409);
    const { data: upd } = await svc.from("traveller_trip_requests")
      .update({ status: "pending_review" }).eq("id", reqId).eq("created_by", userId).in("status", ["draft", "needs_clarification"])
      .select("id, status").maybeSingle();
    if (!upd) return errorResponse("CANNOT_SUBMIT: 0 rows changed", 409);
    return successResponse({ success: true, action, request: upd });
  }

  if (action === "list_requests") {
    const { data: requests } = await svc.from("traveller_trip_requests")
      .select("id, trip_name, start_date, end_date, destination_summary, raw_notes, status, created_at, updated_at")
      .eq("created_by", userId).order("created_at", { ascending: false });
    const reqIds = (requests ?? []).map((r: { id: string }) => r.id);
    let segments: Record<string, unknown>[] = [];
    if (reqIds.length > 0) {
      const { data: segs } = await svc.from("traveller_trip_request_segments")
        .select("id, trip_request_id, segment_type, start_time, end_time, origin, destination, location_name, address, carrier_or_provider, flight_or_train_number, confirmation_reference, notes, missing_fields, confidence, created_at")
        .in("trip_request_id", reqIds).order("created_at", { ascending: true });
      segments = segs ?? [];
    }
    return successResponse({ success: true, action, requests: requests ?? [], segments });
  }

  return errorResponse("UNKNOWN_ACTION: must be create_draft, add_segment, update_draft, submit_for_review, or list_requests", 400);
});
